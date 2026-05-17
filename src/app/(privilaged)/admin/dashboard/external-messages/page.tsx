"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Inbox,
  Loader2,
  Mail,
  School,
  Building2,
  Archive,
  Trash2,
  CheckCircle2,
  Phone,
  AtSign,
  Send,
  PenLine,
  Reply,
} from "lucide-react";

type Source = "contact" | "school-manager" | "enterprise" | "compose" | "email";
type Status = "new" | "read" | "archived";
type Direction = "inbound" | "outbound";
type Tab = "inbox" | "compose";

interface MessageRow {
  id: string;
  source: Source;
  direction: Direction;
  locale: "fr" | "en";
  senderName: string;
  senderEmail: string;
  senderPhone?: string;
  recipientEmail?: string;
  recipientName?: string;
  subject?: string;
  message: string;
  htmlBody?: string;
  metadata?: Record<string, string>;
  status: Status;
  adminNotes?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt?: string;
  emailMessageId?: string;
  emailInReplyTo?: string;
  parentMessageId?: string;
  userId?: string;
}

const SOURCE_META: Record<
  Source,
  { icon: typeof Mail; colorClass: string }
> = {
  contact: { icon: Mail, colorClass: "text-primary" },
  "school-manager": { icon: School, colorClass: "text-amber-600" },
  enterprise: { icon: Building2, colorClass: "text-emerald-600" },
  compose: { icon: Send, colorClass: "text-sky-600" },
  email: { icon: AtSign, colorClass: "text-indigo-600" },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AdminExternalMessagesPage() {
  const t = useTranslations("AdminExternalMessages");

  const [activeTab, setActiveTab] = useState<Tab>("inbox");
  const [rows, setRows] = useState<MessageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<Source | "all">("all");
  // "sent" is a virtual status that flips the query to direction=outbound.
  const [filterStatus, setFilterStatus] = useState<Status | "all" | "sent">(
    "all",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MessageRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // Composer state
  const [compTo, setCompTo] = useState("");
  const [compRecipientName, setCompRecipientName] = useState("");
  const [compSubject, setCompSubject] = useState("");
  const [compMessage, setCompMessage] = useState("");
  // When replying to an email thread, this carries the parent message id so
  // the API can chain In-Reply-To / References for the recipient's mail client.
  const [compInReplyToId, setCompInReplyToId] = useState<string | null>(null);
  const [compSending, setCompSending] = useState(false);
  const [compFeedback, setCompFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const showingOutbound = filterStatus === "sent";

  const fetchList = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (showingOutbound) {
        params.set("direction", "outbound");
      } else {
        params.set("direction", "inbound");
        if (filterSource !== "all") params.set("source", filterSource);
        if (filterStatus !== "all") params.set("status", filterStatus);
      }
      const res = await fetch(
        `/api/admin/external-messages?${params.toString()}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to load");
      }
      const data = (await res.json()) as MessageRow[];
      setRows(data);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [filterSource, filterStatus, showingOutbound]);

  useEffect(() => {
    if (activeTab === "inbox") {
      fetchList();
    }
  }, [activeTab, fetchList]);

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/admin/external-messages/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to load");
      }
      const data = (await res.json()) as MessageRow;
      setDetail(data);
      setNotesDraft(data.adminNotes ?? "");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId);
    }
  }, [selectedId, fetchDetail]);

  const updateStatus = async (id: string, status: Status) => {
    const res = await fetch(`/api/admin/external-messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      await fetchList();
      if (selectedId === id) {
        await fetchDetail(id);
      }
    }
  };

  const saveNotes = async () => {
    if (!detail) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/admin/external-messages/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminNotes: notesDraft }),
      });
      if (res.ok) {
        const data = (await res.json()) as MessageRow;
        setDetail(data);
      }
    } finally {
      setSavingNotes(false);
    }
  };

  const deleteMessage = async (id: string) => {
    if (!window.confirm(t("confirmDelete"))) return;
    const res = await fetch(`/api/admin/external-messages/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      await fetchList();
    }
  };

  const counts = useMemo(() => {
    if (!rows) return { new: 0, total: 0 };
    return {
      new: rows.filter((r) => r.status === "new").length,
      total: rows.length,
    };
  }, [rows]);

  const resetComposer = () => {
    setCompTo("");
    setCompRecipientName("");
    setCompSubject("");
    setCompMessage("");
    setCompInReplyToId(null);
    setCompFeedback(null);
  };

  const replyTo = (msg: MessageRow) => {
    const prefix = t("replyPrefix");
    const baseSubject = msg.subject?.trim() || "";
    const subject = baseSubject
      ? baseSubject.toLowerCase().startsWith(prefix.toLowerCase())
        ? baseSubject
        : `${prefix} ${baseSubject}`
      : prefix;

    const quoteHeader = t("replyQuoteHeader", {
      date: new Date(msg.createdAt).toLocaleString(),
      name: msg.senderName,
    });
    const quotedBody = msg.message
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

    setCompTo(msg.senderEmail);
    setCompRecipientName(msg.senderName);
    setCompSubject(subject);
    setCompMessage(`\n\n${quoteHeader}\n${quotedBody}`);
    // Only thread when we have a Message-Id to chain — non-email rows (web
    // form submissions) don't have one, so the reply ships as a fresh thread.
    setCompInReplyToId(msg.emailMessageId ? msg.id : null);
    setCompFeedback(null);
    setActiveTab("compose");
  };

  const sendComposed = async (e: React.FormEvent) => {
    e.preventDefault();
    const to = compTo.trim().toLowerCase();
    const subject = compSubject.trim();
    const message = compMessage.trim();

    if (!to || !subject || !message) {
      setCompFeedback({ type: "error", text: t("composeMissingFields") });
      return;
    }
    if (!EMAIL_RE.test(to)) {
      setCompFeedback({ type: "error", text: t("composeInvalidEmail") });
      return;
    }

    setCompSending(true);
    setCompFeedback(null);
    try {
      const res = await fetch("/api/admin/external-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          recipientName: compRecipientName.trim() || undefined,
          subject,
          message,
          inReplyToId: compInReplyToId ?? undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? t("composeError"));
      }
      setCompFeedback({ type: "success", text: t("composeSuccess") });
      setCompTo("");
      setCompRecipientName("");
      setCompSubject("");
      setCompMessage("");
      setCompInReplyToId(null);
      // Refresh the inbox so the new outbound shows up if user switches tabs.
      fetchList();
    } catch (err) {
      setCompFeedback({
        type: "error",
        text: err instanceof Error ? err.message : t("composeError"),
      });
    } finally {
      setCompSending(false);
    }
  };

  const sourceLabelFor = (source: Source) =>
    source === "contact"
      ? t("sourceContact")
      : source === "school-manager"
        ? t("sourceSchool")
        : source === "enterprise"
          ? t("sourceEnterprise")
          : source === "email"
            ? t("sourceEmail")
            : t("sourceCompose");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-light text-foreground">
          {t("title")}
        </h1>
        <p className="mt-2 text-muted-foreground font-light">{t("subtitle")}</p>
      </div>

      {/* Top tabs: Réception | Composer */}
      <div className="flex gap-2 border-b border-border/40">
        <TabButton
          active={activeTab === "inbox"}
          onClick={() => setActiveTab("inbox")}
          icon={Inbox}
          label={t("tabInbox")}
        />
        <TabButton
          active={activeTab === "compose"}
          onClick={() => setActiveTab("compose")}
          icon={PenLine}
          label={t("tabCompose")}
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {activeTab === "inbox" ? (
        <>
          <div className="flex flex-wrap gap-3 items-center">
            {!showingOutbound ? (
              <>
                <FilterChip
                  active={filterSource === "all"}
                  onClick={() => setFilterSource("all")}
                  label={t("filterAllSources")}
                />
                <FilterChip
                  active={filterSource === "contact"}
                  onClick={() => setFilterSource("contact")}
                  label={t("sourceContact")}
                />
                <FilterChip
                  active={filterSource === "school-manager"}
                  onClick={() => setFilterSource("school-manager")}
                  label={t("sourceSchool")}
                />
                <FilterChip
                  active={filterSource === "enterprise"}
                  onClick={() => setFilterSource("enterprise")}
                  label={t("sourceEnterprise")}
                />
                <FilterChip
                  active={filterSource === "email"}
                  onClick={() => setFilterSource("email")}
                  label={t("sourceEmail")}
                />
                <span className="mx-1 h-5 w-px bg-border/60" />
              </>
            ) : null}
            <FilterChip
              active={filterStatus === "all"}
              onClick={() => setFilterStatus("all")}
              label={t("filterAllStatuses")}
            />
            <FilterChip
              active={filterStatus === "new"}
              onClick={() => setFilterStatus("new")}
              label={t("statusNew")}
            />
            <FilterChip
              active={filterStatus === "read"}
              onClick={() => setFilterStatus("read")}
              label={t("statusRead")}
            />
            <FilterChip
              active={filterStatus === "archived"}
              onClick={() => setFilterStatus("archived")}
              label={t("statusArchived")}
            />
            <FilterChip
              active={filterStatus === "sent"}
              onClick={() => {
                setFilterStatus("sent");
                setFilterSource("all");
                setSelectedId(null);
                setDetail(null);
              }}
              label={t("statusSent")}
            />
            <span className="ml-auto text-xs text-muted-foreground">
              {showingOutbound
                ? t("countSummarySent", { total: counts.total })
                : t("countSummary", { total: counts.total, unread: counts.new })}
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
              {!rows ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : rows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                  <Inbox className="h-8 w-8" />
                  <p className="text-sm">
                    {showingOutbound ? t("emptySent") : t("empty")}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/40 max-h-[70vh] overflow-y-auto">
                  {rows.map((row) => {
                    const meta = SOURCE_META[row.source] ?? SOURCE_META.contact;
                    const Icon = meta.icon;
                    const isSelected = row.id === selectedId;
                    const displayName =
                      row.direction === "outbound"
                        ? row.recipientEmail ?? row.recipientName ?? "—"
                        : row.senderName;
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(row.id)}
                          className={`w-full text-left px-4 py-3 transition-colors hover:bg-muted/40 ${
                            isSelected ? "bg-muted/60" : ""
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`mt-1 ${meta.colorClass}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {row.direction === "outbound" ? (
                                  <span className="text-xs text-muted-foreground">
                                    {t("sentTo")}
                                  </span>
                                ) : null}
                                <span
                                  className={`text-sm ${
                                    row.status === "new"
                                      ? "font-semibold text-foreground"
                                      : "font-medium text-foreground"
                                  }`}
                                >
                                  {displayName}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  · {sourceLabelFor(row.source)}
                                </span>
                                {row.status === "new" &&
                                row.direction !== "outbound" ? (
                                  <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                                    {t("statusNew")}
                                  </span>
                                ) : null}
                                {row.status === "archived" ? (
                                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                    {t("statusArchived")}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {row.subject || row.message.slice(0, 80)}
                              </p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                                {new Date(
                                  row.sentAt ?? row.createdAt,
                                ).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-border/40 bg-card p-6">
              {!selectedId ? (
                <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
                  <Mail className="h-8 w-8" />
                  <p className="text-sm">{t("selectPrompt")}</p>
                </div>
              ) : detailLoading || !detail ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-serif text-xl font-medium text-foreground">
                        {detail.direction === "outbound"
                          ? detail.recipientName ||
                            detail.recipientEmail ||
                            "—"
                          : detail.senderName}
                      </h2>
                      <span className="text-xs text-muted-foreground">
                        · {sourceLabelFor(detail.source)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(
                        detail.sentAt ?? detail.createdAt,
                      ).toLocaleString()}{" "}
                      · {detail.locale.toUpperCase()}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3 text-sm">
                    {detail.direction === "outbound" ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <span className="text-xs uppercase tracking-wider">
                            {t("sentTo")}
                          </span>
                        </span>
                        <a
                          href={`mailto:${detail.recipientEmail}`}
                          className="inline-flex items-center gap-1.5 text-primary hover:underline"
                        >
                          <AtSign className="h-3.5 w-3.5" />
                          {detail.recipientEmail}
                        </a>
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <span className="text-xs uppercase tracking-wider">
                            {t("sentBy")}
                          </span>
                          {detail.senderName}
                        </span>
                      </>
                    ) : (
                      <>
                        <a
                          href={`mailto:${detail.senderEmail}`}
                          className="inline-flex items-center gap-1.5 text-primary hover:underline"
                        >
                          <AtSign className="h-3.5 w-3.5" />
                          {detail.senderEmail}
                        </a>
                        {detail.senderPhone ? (
                          <a
                            href={`tel:${detail.senderPhone}`}
                            className="inline-flex items-center gap-1.5 text-primary hover:underline"
                          >
                            <Phone className="h-3.5 w-3.5" />
                            {detail.senderPhone}
                          </a>
                        ) : null}
                      </>
                    )}
                  </div>

                  {detail.subject ? (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        {t("fieldSubject")}
                      </p>
                      <p className="text-sm font-medium text-foreground">
                        {detail.subject}
                      </p>
                    </div>
                  ) : null}

                  {detail.metadata &&
                  Object.keys(detail.metadata).length > 0 ? (
                    <div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-1">
                      {Object.entries(detail.metadata).map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-xs">
                          <span className="text-muted-foreground capitalize w-32 shrink-0">
                            {k}
                          </span>
                          <span className="text-foreground">{v}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                      {t("fieldMessage")}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">
                      {detail.message || (
                        <span className="italic text-muted-foreground">
                          {t("noMessage")}
                        </span>
                      )}
                    </p>
                  </div>

                  {detail.source === "email" && detail.parentMessageId ? (
                    <div className="rounded-lg border border-indigo-200/40 bg-indigo-50/40 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100">
                      <button
                        type="button"
                        onClick={() => setSelectedId(detail.parentMessageId!)}
                        className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
                      >
                        <Reply className="h-3.5 w-3.5 rotate-180" />
                        {t("threadParent")}
                      </button>
                    </div>
                  ) : null}

                  {detail.direction !== "outbound" ? (
                    <div className="border-t border-border/40 pt-4 space-y-2">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">
                        {t("adminNotes")}
                      </label>
                      <textarea
                        value={notesDraft}
                        onChange={(e) => setNotesDraft(e.target.value)}
                        placeholder={t("adminNotesPlaceholder")}
                        rows={3}
                        className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={saveNotes}
                        disabled={
                          savingNotes ||
                          notesDraft === (detail.adminNotes ?? "")
                        }
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {savingNotes ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        {t("saveNotes")}
                      </button>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2 border-t border-border/40 pt-4">
                    {detail.direction !== "outbound" ? (
                      <button
                        type="button"
                        onClick={() => replyTo(detail)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        <Reply className="h-3.5 w-3.5" />
                        {t("reply")}
                      </button>
                    ) : null}
                    {detail.status !== "archived" ? (
                      <button
                        type="button"
                        onClick={() => updateStatus(detail.id, "archived")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        {t("archive")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => updateStatus(detail.id, "read")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      >
                        <Inbox className="h-3.5 w-3.5" />
                        {t("unarchive")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteMessage(detail.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t("delete")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        // Compose tab
        <form
          onSubmit={sendComposed}
          className="max-w-2xl space-y-4 rounded-xl border border-border/40 bg-card p-6"
        >
          <div>
            <h2 className="font-serif text-xl font-medium text-foreground">
              {t("composeTitle")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground font-light">
              {t("composeDescription")}
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="comp-to"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              {t("fieldTo")} <span className="text-destructive">*</span>
            </label>
            <input
              id="comp-to"
              type="email"
              value={compTo}
              onChange={(e) => setCompTo(e.target.value)}
              placeholder={t("fieldToPlaceholder")}
              required
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="comp-name"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              {t("fieldRecipientName")}
            </label>
            <input
              id="comp-name"
              type="text"
              value={compRecipientName}
              onChange={(e) => setCompRecipientName(e.target.value)}
              placeholder={t("fieldRecipientNamePlaceholder")}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="comp-subject"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              {t("fieldSubject")} <span className="text-destructive">*</span>
            </label>
            <input
              id="comp-subject"
              type="text"
              value={compSubject}
              onChange={(e) => setCompSubject(e.target.value)}
              placeholder={t("fieldSubjectPlaceholder")}
              required
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {compInReplyToId ? (
            <div className="rounded-lg border border-indigo-200/40 bg-indigo-50/40 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100">
              {t("composeReplyThreaded")}
              <button
                type="button"
                onClick={() => setCompInReplyToId(null)}
                className="ml-2 underline underline-offset-2 hover:no-underline"
              >
                {t("composeUnthread")}
              </button>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label
              htmlFor="comp-message"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              {t("fieldMessage")} <span className="text-destructive">*</span>
            </label>
            <textarea
              id="comp-message"
              value={compMessage}
              onChange={(e) => setCompMessage(e.target.value)}
              placeholder={t("fieldMessagePlaceholder")}
              required
              rows={10}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {compFeedback ? (
            <div
              className={`rounded-lg border p-3 text-sm ${
                compFeedback.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                  : "border-destructive/30 bg-destructive/5 text-destructive"
              }`}
            >
              {compFeedback.text}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={compSending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {compSending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("composeSending")}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  {t("composeSendButton")}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={resetComposer}
              disabled={compSending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-50"
            >
              {t("composeReset")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/40 text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Mail;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
