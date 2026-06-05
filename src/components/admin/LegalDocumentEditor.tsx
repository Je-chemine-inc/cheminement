"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
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
  Undo2,
  Redo2,
  Pilcrow,
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
  headingLevels,
}: {
  editor: Editor;
  promptUrl: () => void;
  headingLevels: (2 | 3)[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border/60 bg-muted/30 p-2">
      <ToolbarButton
        label="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
      >
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border/60" />

      <ToolbarButton
        label="Paragraph"
        onClick={() => editor.chain().focus().setParagraph().run()}
        active={editor.isActive("paragraph")}
      >
        <Pilcrow className="h-4 w-4" />
      </ToolbarButton>
      {headingLevels.includes(2) && (
        <ToolbarButton
          label="Section title (H2)"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          active={editor.isActive("heading", { level: 2 })}
        >
          <Heading2 className="h-4 w-4" />
        </ToolbarButton>
      )}
      {headingLevels.includes(3) && (
        <ToolbarButton
          label="Subsection (H3)"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          active={editor.isActive("heading", { level: 3 })}
        >
          <Heading3 className="h-4 w-4" />
        </ToolbarButton>
      )}

      <span className="mx-1 h-5 w-px bg-border/60" />

      <ToolbarButton
        label="Bullet list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Callout (blockquote)"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border/60" />

      <ToolbarButton label="Insert link" onClick={promptUrl}>
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border/60" />

      <ToolbarButton
        label="Undo"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}

export default function LegalDocumentEditor({
  value,
  onChange,
  headingLevels = [2, 3],
}: {
  value: string;
  onChange: (html: string) => void;
  /** Heading levels the toolbar offers. Section bodies pass [3] so H2 stays
   *  reserved for section titles (owned by the section-cards editor). */
  headingLevels?: (2 | 3)[];
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: headingLevels },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "legal-prose focus:outline-none min-h-[400px] px-5 py-4",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  const promptUrl = () => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", previous ?? "https://");
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

  if (!editor) {
    return (
      <div className="min-h-[400px] rounded-lg border border-border/60 bg-card" />
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <Toolbar
        editor={editor}
        promptUrl={promptUrl}
        headingLevels={headingLevels}
      />
      <EditorContent editor={editor} />
    </div>
  );
}

