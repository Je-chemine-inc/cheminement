"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SchoolManagerPage() {
  const t = useTranslations("SchoolManagerForm");
  const locale = useLocale();
  const serviceTypes = t.raw("serviceTypes") as string[];

  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [message, setMessage] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [serviceTypeError, setServiceTypeError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPhoneError("");
    setServiceTypeError("");
    setSuccess(false);

    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setPhoneError(t("validation.phoneDigits"));
      return;
    }
    if (!serviceType) {
      setServiceTypeError(t("validation.serviceTypeRequired"));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/school-manager/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          school,
          role,
          phone,
          email,
          serviceType,
          message,
          locale,
        }),
      });
      if (!response.ok) {
        throw new Error("Submit failed");
      }
      setSuccess(true);
      setName("");
      setSchool("");
      setRole("");
      setPhone("");
      setEmail("");
      setServiceType("");
      setMessage("");
    } catch (err) {
      console.error("School manager form error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="bg-background">
      <section className="container mx-auto max-w-3xl px-6 py-24">
        <div className="rounded-4xl border border-border/20 bg-card/80 p-10 shadow-xl backdrop-blur">
          <div className="space-y-4 text-center">
            <p className="text-sm uppercase tracking-[0.35em] text-muted-foreground/70">
              {t("badge")}
            </p>
            <h1 className="font-serif text-3xl font-medium text-foreground md:text-4xl">
              {t("title")}
            </h1>
            <p className="text-base leading-relaxed text-muted-foreground">
              {t("description")}
            </p>
          </div>

          {success ? (
            <p
              className="mt-10 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-center text-sm text-foreground"
              role="status"
            >
              {t("success")}
            </p>
          ) : null}

          <form className="mt-10 space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="name">{t("fields.name")}</Label>
              <Input
                id="name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("placeholders.name")}
                autoComplete="name"
                required
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="school">{t("fields.school")}</Label>
              <Input
                id="school"
                name="school"
                value={school}
                onChange={(e) => setSchool(e.target.value)}
                placeholder={t("placeholders.school")}
                autoComplete="organization"
                required
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="function">{t("fields.function")}</Label>
              <Input
                id="function"
                name="function"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder={t("placeholders.function")}
                required
                className="h-12"
              />
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone">{t("fields.phone")}</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  title={t("validation.phoneHint")}
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setPhoneError("");
                  }}
                  placeholder={t("placeholders.phone")}
                  autoComplete="tel"
                  required
                  aria-invalid={phoneError ? true : undefined}
                  className="h-12"
                />
                {phoneError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {phoneError}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t("fields.email")}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("placeholders.email")}
                  autoComplete="email"
                  required
                  className="h-12"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-type">{t("fields.serviceType")}</Label>
              <Select
                value={serviceType || undefined}
                onValueChange={(v) => {
                  setServiceType(v);
                  setServiceTypeError("");
                }}
              >
                <SelectTrigger
                  id="service-type"
                  className="h-12 w-full"
                  aria-invalid={serviceTypeError ? true : undefined}
                >
                  <SelectValue placeholder={t("placeholders.serviceType")} />
                </SelectTrigger>
                <SelectContent>
                  {serviceTypes.map((type: string) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {serviceTypeError ? (
                <p className="text-sm text-destructive" role="alert">
                  {serviceTypeError}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">{t("fields.message")}</Label>
              <Textarea
                id="message"
                name="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("placeholders.message")}
                required
                rows={6}
                className="min-h-[140px] resize-y font-light"
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t("submitting") : t("submit")}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
