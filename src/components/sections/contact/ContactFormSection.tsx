"use client";

import { useState } from "react";
import { ClipboardPen, Send, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import ScrollReveal from "@/components/ui/ScrollReveal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export default function ContactFormSection() {
  const t = useTranslations("Contact.form");
  const locale = useLocale();
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus("idle");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, locale }),
      });

      if (!response.ok) {
        throw new Error("Submit failed");
      }

      setSubmitStatus("success");
      setFormData({
        firstName: "",
        lastName: "",
        phone: "",
        email: "",
        message: "",
      });
    } catch {
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="relative overflow-hidden bg-linear-to-b from-muted via-background to-muted py-24">
      <div className="absolute inset-0 opacity-[0.06]">
        <div className="absolute left-0 top-24 h-80 w-80 -translate-x-1/3 rounded-full bg-primary blur-3xl" />
        <div className="absolute right-0 bottom-0 h-104 w-104 translate-x-1/4 translate-y-1/3 rounded-full bg-accent blur-3xl" />
      </div>

      <div className="container relative z-10 mx-auto px-6">
        <ScrollReveal variant="zoom-in" duration={800}>
          <div className="mx-auto max-w-3xl rounded-4xl bg-card/85 p-8 md:p-12 shadow-xl backdrop-blur">
            <div className="mb-8">
              <ScrollReveal variant="swing-in" delayMs={150} duration={600}>
                <div className="inline-flex items-center gap-3 rounded-full border border-primary/30 bg-muted/40 px-5 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground mb-6">
                  <ClipboardPen className="h-4 w-4" />
                  <span>{t("badge")}</span>
                </div>
              </ScrollReveal>
              <ScrollReveal variant="blur-in" delayMs={250} duration={700}>
                <h2 className="font-serif text-3xl font-medium leading-tight text-foreground md:text-4xl mb-4">
                  {t("title")}
                </h2>
              </ScrollReveal>
              <ScrollReveal variant="fade-up" delayMs={350} duration={600}>
                <p className="text-base leading-relaxed text-muted-foreground">
                  {t("description")}
                </p>
              </ScrollReveal>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ScrollReveal variant="fade-right" delayMs={400} duration={600}>
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="text-sm font-light">
                      Prénom | first name <span className="text-primary">*</span>
                    </Label>
                    <Input
                      id="firstName"
                      name="firstName"
                      type="text"
                      required
                      value={formData.firstName}
                      onChange={handleChange}
                      placeholder="Votre prénom"
                      className="h-12 font-light"
                    />
                  </div>
                </ScrollReveal>

                <ScrollReveal variant="fade-left" delayMs={450} duration={600}>
                  <div className="space-y-2">
                    <Label htmlFor="lastName" className="text-sm font-light">
                      Nom | last name <span className="text-primary">*</span>
                    </Label>
                    <Input
                      id="lastName"
                      name="lastName"
                      type="text"
                      required
                      value={formData.lastName}
                      onChange={handleChange}
                      placeholder="Votre nom"
                      className="h-12 font-light"
                    />
                  </div>
                </ScrollReveal>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ScrollReveal variant="fade-right" delayMs={500} duration={600}>
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-sm font-light">
                      Numéro de téléphone | phone number <span className="text-primary">*</span>
                    </Label>
                    <Input
                      id="phone"
                      name="phone"
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder="(514) 123-4567"
                      className="h-12 font-light"
                    />
                  </div>
                </ScrollReveal>

                <ScrollReveal variant="fade-left" delayMs={550} duration={600}>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-light">
                      Adresse courriel | email address <span className="text-primary">*</span>
                    </Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      required
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="votre@courriel.com"
                      className="h-12 font-light"
                    />
                  </div>
                </ScrollReveal>
              </div>

              <ScrollReveal variant="fade-up" delayMs={600} duration={600}>
                <div className="space-y-2">
                  <Label htmlFor="message" className="text-sm font-light">
                    Message <span className="text-primary">*</span>
                  </Label>
                  <Textarea
                    id="message"
                    name="message"
                    required
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="Votre message..."
                    className="min-h-[150px] w-full resize-y font-light"
                  />
                </div>
              </ScrollReveal>

              {submitStatus === "success" && (
                <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 p-4 text-sm text-green-800 dark:text-green-200">
                  {t("successMessage")}
                </div>
              )}

              {submitStatus === "error" && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-4 text-sm text-red-800 dark:text-red-200">
                  {t("errorMessage")}
                </div>
              )}

              <ScrollReveal variant="zoom-in" delayMs={650} duration={600}>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full md:w-auto px-8 py-6 bg-primary text-primary-foreground rounded-full text-base font-light tracking-wide transition-all duration-300 hover:scale-105 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      {t("submitting")}
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-5 w-5" />
                      {t("submit")}
                    </>
                  )}
                </Button>
              </ScrollReveal>
            </form>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
