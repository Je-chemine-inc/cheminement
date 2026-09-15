"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  ImagePlus,
  Undo2,
  Redo2,
  Pilcrow,
  Loader2,
} from "lucide-react";

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground transition-colors ${
        active
          ? "bg-primary/15 text-primary"
          : "hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({
  editor,
  promptUrl,
  pickImage,
  uploading,
}: {
  editor: Editor;
  promptUrl: () => void;
  pickImage: () => void;
  uploading: boolean;
}) {
  const t = useTranslations("ContentEditor");
  return (
    <div
      role="group"
      aria-label={t("toolbar")}
      className="flex flex-wrap items-center gap-1 border-b border-border/60 bg-muted/30 p-2"
    >
      <ToolbarButton
        label={t("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
      >
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border/60" />

      <ToolbarButton
        label={t("paragraph")}
        onClick={() => editor.chain().focus().setParagraph().run()}
        active={editor.isActive("paragraph")}
      >
        <Pilcrow className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("heading2")}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
        active={editor.isActive("heading", { level: 2 })}
      >
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("heading3")}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 3 }).run()
        }
        active={editor.isActive("heading", { level: 3 })}
      >
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border/60" />

      <ToolbarButton
        label={t("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border/60" />

      <ToolbarButton label={t("link")} onClick={promptUrl}>
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("image")}
        onClick={pickImage}
        disabled={uploading}
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ImagePlus className="h-4 w-4" />
        )}
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border/60" />

      <ToolbarButton
        label={t("undo")}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("redo")}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}

type UploadErrorKey =
  | "uploadTooLarge"
  | "uploadType"
  | "uploadInfected"
  | "uploadScanUnavailable"
  | "uploadFailed";

/**
 * The upload routes answer in English, or in both languages at once; the
 * editor tells the writer in their own. See lib/upload-pipeline.ts and the two
 * upload routes for the statuses.
 */
function uploadErrorKey(status: number, error: string): UploadErrorKey {
  if (status === 400 && /size/i.test(error)) return "uploadTooLarge";
  if (status === 400 || status === 415) return "uploadType";
  if (status === 422) return "uploadInfected";
  if (status === 503) return "uploadScanUnavailable";
  return "uploadFailed";
}

export default function ContentEntryEditor({
  value,
  onChange,
  uploadFolder = "content",
  uploadEndpoint = "/api/admin/uploads",
  accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml",
}: {
  value: string;
  onChange: (html: string) => void;
  /** Subfolder under /public/uploads to place inline images. */
  uploadFolder?: "content" | "problematiques" | "misc";
  /** Where inline images are uploaded: a professional's product uses its own route (spec 003 phase 5). */
  uploadEndpoint?: string;
  /** The image types the picker offers. */
  accept?: string;
}) {
  const t = useTranslations("ContentEditor");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Image.configure({
        HTMLAttributes: {
          class: "content-image",
          loading: "lazy",
        },
      }),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "legal-prose focus:outline-none min-h-[420px] px-5 py-4",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  const promptUrl = () => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt(t("linkPrompt"), previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  };

  const pickImage = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editor) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", uploadFolder);
      const res = await fetch(uploadEndpoint, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: unknown };
        const detail = typeof data.error === "string" ? data.error : "";
        console.warn("Image upload refused:", res.status, detail);
        setUploadError(t(uploadErrorKey(res.status, detail)));
        return;
      }
      const { url } = (await res.json()) as { url: string };
      editor.chain().focus().setImage({ src: url, alt: file.name }).run();
    } catch (err) {
      console.error("Image upload error:", err);
      setUploadError(t("uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  if (!editor) {
    return (
      <div className="min-h-[420px] rounded-lg border border-border/60 bg-card" />
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <Toolbar
        editor={editor}
        promptUrl={promptUrl}
        pickImage={pickImage}
        uploading={uploading}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
      />
      {uploadError ? (
        <div
          role="alert"
          className="border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive"
        >
          {uploadError}
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
