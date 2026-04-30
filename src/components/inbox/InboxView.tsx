"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  MessageSquare,
  Send,
  Plus,
  ArrowLeft,
  Loader2,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Participant {
  id: string;
  name: string;
  role: string;
}

interface Conversation {
  id: string;
  subject: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unread: number;
  participants: Participant[];
}

interface Message {
  id: string;
  body: string;
  createdAt: string;
  isOwn: boolean;
  senderName: string;
}

interface Contact {
  id: string;
  name: string;
  role: string;
}

export default function InboxView() {
  const t = useTranslations("Dashboard.inbox");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeConv, setActiveConv] = useState<{ subject: string; participants: Participant[] } | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [composeRecipient, setComposeRecipient] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      setLoadingConvs(true);
      const res = await fetch("/api/messages");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setConversations(data.conversations);
    } catch {
      setError(t("loadError"));
    } finally {
      setLoadingConvs(false);
    }
  }, [t]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openConversation = async (convId: string) => {
    setActiveConvId(convId);
    setLoadingMsgs(true);
    setMessages([]);
    try {
      const res = await fetch(`/api/messages/${convId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMessages(data.messages);
      setActiveConv(data.conversation);
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unread: 0 } : c)),
      );
    } catch {
      setError(t("loadError"));
    } finally {
      setLoadingMsgs(false);
    }
  };

  const sendReply = async () => {
    if (!reply.trim() || !activeConvId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/messages/${activeConvId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply }),
      });
      if (!res.ok) throw new Error();
      setReply("");
      await openConversation(activeConvId);
      loadConversations();
    } catch {
      setError(t("sendError"));
    } finally {
      setSending(false);
    }
  };

  const openCompose = async () => {
    setShowCompose(true);
    if (contacts.length === 0) {
      const res = await fetch("/api/messages/contacts");
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts);
      }
    }
  };

  const sendCompose = async () => {
    if (!composeRecipient || !composeSubject.trim() || !composeBody.trim()) return;
    setComposeSending(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientId: composeRecipient,
          subject: composeSubject,
          message: composeBody,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setShowCompose(false);
      setComposeRecipient("");
      setComposeSubject("");
      setComposeBody("");
      await loadConversations();
      openConversation(data.conversationId);
    } catch {
      setError(t("sendError"));
    } finally {
      setComposeSending(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = diffMs / 3600000;
    if (diffH < 24) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-3xl border border-border/20 bg-card/60 shadow-inner">
      {/* Left pane — conversation list */}
      <div
        className={`flex flex-col border-r border-border/20 ${
          activeConvId ? "hidden md:flex" : "flex"
        } w-full md:w-80 shrink-0`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border/20 px-4 py-4">
          <div>
            <h1 className="font-serif text-xl font-light text-foreground">{t("title")}</h1>
            <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
          </div>
          <Button size="sm" className="rounded-full gap-1.5" onClick={openCompose}>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("newMessage")}</span>
          </Button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
              <p className="text-xs text-muted-foreground/60">{t("noConversationsDesc")}</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => openConversation(conv.id)}
                className={`w-full text-left px-4 py-3.5 border-b border-border/10 transition-colors hover:bg-muted/40 ${
                  activeConvId === conv.id ? "bg-muted/60" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className={`text-sm font-medium truncate ${conv.unread > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                    {conv.participants.map((p) => p.name).join(", ")}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDate(conv.lastMessageAt)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground font-medium truncate mb-0.5">
                  {conv.subject}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground/70 truncate flex-1">
                    {conv.lastMessagePreview}
                  </p>
                  {conv.unread > 0 && (
                    <span className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-4 h-4 shrink-0">
                      {conv.unread}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right pane — thread */}
      <div className={`flex flex-col flex-1 min-w-0 ${activeConvId ? "flex" : "hidden md:flex"}`}>
        {!activeConvId ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center p-6">
            <MessageSquare className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">{t("selectConversation")}</p>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-3 border-b border-border/20 px-4 py-3.5">
              <button
                onClick={() => setActiveConvId(null)}
                className="md:hidden text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {activeConv?.subject}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {activeConv?.participants.map((p) => p.name).join(", ")}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {loadingMsgs ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">{t("noMessages")}</p>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-2.5 ${msg.isOwn ? "justify-end" : "justify-start"}`}
                  >
                    {!msg.isOwn && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                    <div
                      className={`max-w-[75%] space-y-1 ${msg.isOwn ? "items-end" : "items-start"} flex flex-col`}
                    >
                      <span className="text-[11px] text-muted-foreground px-1">
                        {msg.isOwn ? t("you") : msg.senderName}
                      </span>
                      <div
                        className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          msg.isOwn
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-muted text-foreground rounded-bl-sm"
                        }`}
                      >
                        {msg.body}
                      </div>
                      <span className="text-[10px] text-muted-foreground/60 px-1">
                        {formatDate(msg.createdAt)}
                      </span>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply bar */}
            <div className="border-t border-border/20 px-4 py-3">
              {error && (
                <p className="text-xs text-destructive mb-2">{error}</p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
                  placeholder={t("messagePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <Button
                  size="sm"
                  className="rounded-full h-9 w-9 p-0 shrink-0"
                  onClick={sendReply}
                  disabled={!reply.trim() || sending}
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
              <h2 className="font-serif text-lg font-light text-foreground">{t("composeTitle")}</h2>
              <button
                onClick={() => setShowCompose(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("toLabel")}
                </label>
                <select
                  value={composeRecipient}
                  onChange={(e) => setComposeRecipient(e.target.value)}
                  className="w-full rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">—</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("subjectLabel")}
                </label>
                <input
                  type="text"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  placeholder={t("subjectPlaceholder")}
                  className="w-full rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("messagePlaceholder")}
                </label>
                <textarea
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  rows={4}
                  placeholder={t("messagePlaceholder")}
                  className="w-full resize-none rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  onClick={() => setShowCompose(false)}
                  disabled={composeSending}
                >
                  {t("cancel")}
                </Button>
                <Button
                  onClick={sendCompose}
                  disabled={!composeRecipient || !composeSubject.trim() || !composeBody.trim() || composeSending}
                  className="gap-2"
                >
                  {composeSending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("sending")}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      {t("send")}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
