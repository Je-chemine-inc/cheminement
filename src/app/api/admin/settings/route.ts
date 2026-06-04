import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import PlatformSettings, {
  getDefaultEmailSettings,
} from "@/models/PlatformSettings";
import { authOptions } from "@/lib/auth";
import { clearEmailSettingsCache } from "@/lib/notifications";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    let settings = await PlatformSettings.findOne();

    // If no settings exist, create default settings
    if (!settings) {
      settings = new PlatformSettings({
        defaultPricing: {
          solo: 120,
          couple: 150,
          group: 80,
        },
        platformFeePercentage: 10,
        currency: "CAD",
        cancellationPolicy: {
          clientCancellationHours: 24,
          clientRefundPercentage: 100,
          professionalCancellationHours: 12,
        },
        emailSettings: getDefaultEmailSettings(),
      });
      await settings.save();
    }

    // Convert Map to object for JSON serialization
    const settingsObj = settings.toObject();
    if (settingsObj.emailSettings?.templates instanceof Map) {
      settingsObj.emailSettings.templates = Object.fromEntries(
        settingsObj.emailSettings.templates,
      );
    }

    return NextResponse.json(settingsObj);
  } catch (error: unknown) {
    console.error("Get platform settings error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch platform settings",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const data = await req.json();

    // Validate pricing values
    if (data.defaultPricing) {
      if (
        data.defaultPricing.solo < 0 ||
        data.defaultPricing.couple < 0 ||
        data.defaultPricing.group < 0
      ) {
        return NextResponse.json(
          { error: "Pricing values must be positive" },
          { status: 400 },
        );
      }
    }

    // Validate platform fee percentage
    if (
      data.platformFeePercentage !== undefined &&
      (data.platformFeePercentage < 0 || data.platformFeePercentage > 100)
    ) {
      return NextResponse.json(
        { error: "Platform fee percentage must be between 0 and 100" },
        { status: 400 },
      );
    }

    // Validate email settings if provided
    if (data.emailSettings) {
      // Validate branding colors if provided
      if (data.emailSettings.branding) {
        const { primaryColor, secondaryColor } = data.emailSettings.branding;
        const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

        if (primaryColor && !hexColorRegex.test(primaryColor)) {
          return NextResponse.json(
            {
              error:
                "Invalid primary color format. Use hex format (e.g., #8B7355)",
            },
            { status: 400 },
          );
        }
        if (secondaryColor && !hexColorRegex.test(secondaryColor)) {
          return NextResponse.json(
            {
              error:
                "Invalid secondary color format. Use hex format (e.g., #6B5344)",
            },
            { status: 400 },
          );
        }
      }
    }

    let settings = await PlatformSettings.findOne();

    if (!settings) {
      // Create new settings with defaults
      settings = new PlatformSettings({
        ...data,
        emailSettings: data.emailSettings || getDefaultEmailSettings(),
      });
      await settings.save();
    } else {
      // Update existing settings
      if (data.defaultPricing) {
        settings.defaultPricing = {
          ...settings.defaultPricing,
          ...data.defaultPricing,
        };
      }

      if (data.platformFeePercentage !== undefined) {
        settings.platformFeePercentage = data.platformFeePercentage;
      }

      if (data.currency) {
        settings.currency = data.currency;
      }

      if (data.cancellationPolicy) {
        settings.cancellationPolicy = {
          ...settings.cancellationPolicy,
          ...data.cancellationPolicy,
        };
      }

      if (data.platformContact) {
        const incoming = data.platformContact as Partial<{
          physicalAddress: Partial<{
            street: string;
            suite: string;
            city: string;
            province: string;
            postalCode: string;
            country: string;
          }>;
          phoneNumber: string;
          supportEmail: string;
        }>;
        const currentAddress = settings.platformContact?.physicalAddress;
        const isLegacyStringAddress = typeof currentAddress === "string";
        const baseAddress = {
          street: isLegacyStringAddress
            ? String(currentAddress).trim()
            : currentAddress?.street ?? "",
          suite: isLegacyStringAddress ? "" : currentAddress?.suite ?? "",
          city: isLegacyStringAddress ? "" : currentAddress?.city ?? "",
          province: isLegacyStringAddress
            ? ""
            : currentAddress?.province ?? "",
          postalCode: isLegacyStringAddress
            ? ""
            : currentAddress?.postalCode ?? "",
          country: isLegacyStringAddress
            ? "Canada"
            : currentAddress?.country ?? "Canada",
        };
        const inAddr = incoming.physicalAddress;
        const nextAddress = inAddr
          ? {
              street:
                inAddr.street !== undefined
                  ? String(inAddr.street).trim()
                  : baseAddress.street,
              suite:
                inAddr.suite !== undefined
                  ? String(inAddr.suite).trim()
                  : baseAddress.suite,
              city:
                inAddr.city !== undefined
                  ? String(inAddr.city).trim()
                  : baseAddress.city,
              province:
                inAddr.province !== undefined
                  ? String(inAddr.province).trim()
                  : baseAddress.province,
              postalCode:
                inAddr.postalCode !== undefined
                  ? String(inAddr.postalCode).trim().toUpperCase()
                  : baseAddress.postalCode,
              country:
                inAddr.country !== undefined
                  ? String(inAddr.country).trim()
                  : baseAddress.country,
            }
          : baseAddress;

        settings.platformContact = {
          physicalAddress: nextAddress,
          phoneNumber:
            incoming.phoneNumber !== undefined
              ? String(incoming.phoneNumber).trim()
              : settings.platformContact?.phoneNumber ?? "",
          supportEmail:
            incoming.supportEmail !== undefined
              ? String(incoming.supportEmail).trim()
              : settings.platformContact?.supportEmail ??
                "support@jechemine.ca",
        };
      }

      if (data.interacDepositEmail !== undefined) {
        settings.interacDepositEmail = String(data.interacDepositEmail).trim();
      }

      // Admin notification recipient (§3.2). Validate before saving — a bad
      // value here would silently break every platform alert. Empty clears it
      // (falls back to admin accounts / ADMIN_ALERT_EMAIL). Comma-separated allowed.
      if (data.adminAlertEmail !== undefined) {
        const raw = String(data.adminAlertEmail).trim();
        if (raw) {
          const parts = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          const bad = parts.find((p) => !emailRe.test(p));
          if (bad) {
            return NextResponse.json(
              { error: `Invalid admin notification email: ${bad}` },
              { status: 400 },
            );
          }
          settings.adminAlertEmail = parts.join(", ");
        } else {
          settings.adminAlertEmail = "";
        }
      }

      // Footer social-media links (§4). Each field: keep current value if not
      // supplied; empty string hides the icon; otherwise must be an http(s) URL.
      if (data.socialLinks) {
        const incoming = data.socialLinks as Partial<
          Record<
            "facebook" | "x" | "instagram" | "linkedin" | "youtube" | "tiktok",
            unknown
          >
        >;
        const urlRe = /^https?:\/\/.+/i;
        const keys = [
          "facebook",
          "x",
          "instagram",
          "linkedin",
          "youtube",
          "tiktok",
        ] as const;
        const current = settings.socialLinks;
        const resolve = (k: (typeof keys)[number]): string =>
          incoming[k] === undefined
            ? current?.[k] ?? ""
            : String(incoming[k]).trim();
        for (const k of keys) {
          const v = resolve(k);
          if (v && !urlRe.test(v)) {
            return NextResponse.json(
              {
                error: `Invalid social link URL for ${k} (must start with http:// or https://)`,
              },
              { status: 400 },
            );
          }
        }
        settings.socialLinks = {
          facebook: resolve("facebook"),
          x: resolve("x"),
          instagram: resolve("instagram"),
          linkedin: resolve("linkedin"),
          youtube: resolve("youtube"),
          tiktok: resolve("tiktok"),
        };
      }

      // Handle email settings updates
      if (data.emailSettings) {
        if (!settings.emailSettings) {
          settings.emailSettings = getDefaultEmailSettings();
        }

        if (data.emailSettings.enabled !== undefined) {
          settings.emailSettings.enabled = data.emailSettings.enabled;
        }

        if (data.emailSettings.smtpConfigured !== undefined) {
          settings.emailSettings.smtpConfigured =
            data.emailSettings.smtpConfigured;
        }

        if (data.emailSettings.branding) {
          settings.emailSettings.branding = {
            ...settings.emailSettings.branding,
            ...data.emailSettings.branding,
          };
        }

        if (data.emailSettings.templates) {
          // Merge template updates
          for (const [key, value] of Object.entries(
            data.emailSettings.templates,
          )) {
            if (settings.emailSettings.templates instanceof Map) {
              const existing = settings.emailSettings.templates.get(key) || {
                enabled: true,
                subject: "",
              };
              const updateValue = value as {
                enabled?: boolean;
                subject?: string;
              };
              settings.emailSettings.templates.set(key, {
                enabled: updateValue.enabled ?? existing.enabled,
                subject: updateValue.subject ?? existing.subject,
              });
            } else {
              const templatesObj = settings.emailSettings.templates as Record<
                string,
                { enabled: boolean; subject: string }
              >;
              const existing = templatesObj[key] || {
                enabled: true,
                subject: "",
              };
              const updateValue = value as {
                enabled?: boolean;
                subject?: string;
              };
              templatesObj[key] = {
                enabled: updateValue.enabled ?? existing.enabled,
                subject: updateValue.subject ?? existing.subject,
              };
              settings.emailSettings.templates = templatesObj;
            }
          }
        }

        // Clear the email settings cache when settings are updated
        clearEmailSettingsCache();
      }

      await settings.save();
    }

    // Convert Map to object for JSON serialization
    const settingsObj = settings.toObject();
    if (settingsObj.emailSettings?.templates instanceof Map) {
      settingsObj.emailSettings.templates = Object.fromEntries(
        settingsObj.emailSettings.templates,
      );
    }

    return NextResponse.json(settingsObj);
  } catch (error: unknown) {
    console.error("Update platform settings error:", error);
    return NextResponse.json(
      {
        error: "Failed to update platform settings",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
