import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import bcrypt from "bcryptjs";
import connectToDatabase from "./mongodb";
import clientPromise from "./mongodbClient";
import User from "@/models/User";
import AuthAuditLog, { type AuthAuditAction } from "@/models/AuthAuditLog";

async function logAuthEvent(
  email: string,
  action: AuthAuditAction,
  userId?: string,
) {
  try {
    await AuthAuditLog.create({
      email,
      userId: userId || undefined,
      action,
      ip: "server",
      userAgent: "",
    });
  } catch {
    // Non-fatal — never let audit logging break authentication
  }
}

export const authOptions: NextAuthOptions = {
  adapter: MongoDBAdapter(clientPromise) as any,
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Invalid credentials");
        }

        await connectToDatabase();

        const user = await User.findOne({ email: credentials.email });

        if (!user || !user.password) {
          void logAuthEvent(credentials.email, "login_failed");
          throw new Error("Invalid credentials");
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.password,
        );

        if (!isPasswordValid) {
          void logAuthEvent(credentials.email, "login_failed", user._id.toString());
          throw new Error("Invalid credentials");
        }

        if (!user._id) {
          throw new Error("User ID not found");
        }

        const sec = user.accountSecurityVersion ?? 0;
        if (sec >= 1 && (user.role === "client" || user.role === "professional")) {
          if (!user.emailVerified) {
            void logAuthEvent(credentials.email, "login_blocked_unverified", user._id.toString());
            throw new Error("AUTH_EMAIL_NOT_VERIFIED");
          }
          // Phone verification is deferred to the booking flow, not required at login.
        }

        // Inactive client accounts were auto-provisioned by the system but never claimed.
        // Block login and direct them to the signup/claim flow.
        if (user.role === "client" && user.status === "inactive") {
          void logAuthEvent(credentials.email, "login_blocked_unverified", user._id.toString());
          throw new Error("AUTH_ACCOUNT_INACTIVE");
        }

        if (
          user.role === "professional" &&
          user.professionalLicenseStatus === "rejected"
        ) {
          void logAuthEvent(credentials.email, "login_blocked_rejected", user._id.toString());
          throw new Error("AUTH_LICENSE_REJECTED");
        }

        void logAuthEvent(credentials.email, "login_success", user._id.toString());

        return {
          id: user._id.toString(),
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          isAdmin: user.isAdmin || false,
          adminId: user.adminId?.toString(),
          professionalLicenseStatus: user.professionalLicenseStatus,
          image: user.image,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 60, // 30 minutes — refreshed on each server request
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.isAdmin = user.isAdmin;
        token.adminId = user.adminId;
        token.professionalLicenseStatus = user.professionalLicenseStatus;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.isAdmin = token.isAdmin as boolean;
        session.user.adminId = token.adminId as string;
        session.user.professionalLicenseStatus = token.professionalLicenseStatus as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === "development",
};
