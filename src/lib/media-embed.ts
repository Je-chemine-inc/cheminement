import type { MediaType } from "@/lib/content-kind";

/**
 * Resolves a media URL into an inline player when the source is recognized, or
 * a plain external `href` fallback otherwise. Used by the public Médias
 * (/medias) pages.
 *
 * Recognized inline players:
 *  - video:   YouTube, Vimeo, Dailymotion, Loom, and direct video files (.mp4/.webm/.mov/.ogv)
 *  - podcast: Spotify, Apple Podcasts, SoundCloud, and direct audio files (.mp3/.m4a/.wav/.oga)
 * Anything else → `{ kind: "link" }`, rendered as a "watch/listen on source" button.
 */
export type MediaEmbed =
  | { kind: "iframe"; src: string; aspect: "video" | "audio" }
  | { kind: "video-file"; src: string }
  | { kind: "audio-file"; src: string }
  | { kind: "link"; href: string }
  | null;

function clean(url?: string | null): string | null {
  const v = (url ?? "").trim();
  return v.length > 0 ? v : null;
}

/** Lowercased file extension from a URL's path (ignoring query/hash), or null. */
function fileExt(url: string): string | null {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split(/[?#]/)[0];
  }
  const m = pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : null;
}

const VIDEO_FILE_EXTS = new Set(["mp4", "webm", "ogv", "ogg", "mov", "m4v"]);
const AUDIO_FILE_EXTS = new Set([
  "mp3",
  "m4a",
  "aac",
  "wav",
  "oga",
  "opus",
  "flac",
]);

/** YouTube, Vimeo, Dailymotion, Loom, or a direct video file → inline player. */
export function getVideoEmbed(url?: string | null): MediaEmbed {
  const u = clean(url);
  if (!u) return null;

  // Direct, self-hosted (or CDN) video file → native <video>.
  const ext = fileExt(u);
  if (ext && VIDEO_FILE_EXTS.has(ext)) {
    return { kind: "video-file", src: u };
  }

  const yt = u.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i,
  );
  if (yt) {
    return {
      kind: "iframe",
      src: `https://www.youtube-nocookie.com/embed/${yt[1]}`,
      aspect: "video",
    };
  }

  const vimeo = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo) {
    return {
      kind: "iframe",
      src: `https://player.vimeo.com/video/${vimeo[1]}`,
      aspect: "video",
    };
  }

  const dailymotion = u.match(
    /(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([a-z0-9]+)/i,
  );
  if (dailymotion) {
    return {
      kind: "iframe",
      src: `https://www.dailymotion.com/embed/video/${dailymotion[1]}`,
      aspect: "video",
    };
  }

  const loom = u.match(/loom\.com\/(?:share|embed)\/([a-f0-9]+)/i);
  if (loom) {
    return {
      kind: "iframe",
      src: `https://www.loom.com/embed/${loom[1]}`,
      aspect: "video",
    };
  }

  return { kind: "link", href: u };
}

/** Spotify, Apple Podcasts, SoundCloud, or a direct audio file → inline player. */
export function getPodcastEmbed(url?: string | null): MediaEmbed {
  const u = clean(url);
  if (!u) return null;

  // Direct audio file → native <audio>.
  const ext = fileExt(u);
  if (ext && AUDIO_FILE_EXTS.has(ext)) {
    return { kind: "audio-file", src: u };
  }

  const spotify = u.match(
    /open\.spotify\.com\/(episode|show|playlist|track|album)\/([\w]+)/i,
  );
  if (spotify) {
    return {
      kind: "iframe",
      src: `https://open.spotify.com/embed/${spotify[1].toLowerCase()}/${spotify[2]}`,
      aspect: "audio",
    };
  }

  if (/podcasts\.apple\.com/i.test(u)) {
    return {
      kind: "iframe",
      src: u.replace(/podcasts\.apple\.com/i, "embed.podcasts.apple.com"),
      aspect: "audio",
    };
  }

  if (/soundcloud\.com/i.test(u)) {
    return {
      kind: "iframe",
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u)}&visual=false&show_comments=false`,
      aspect: "audio",
    };
  }

  return { kind: "link", href: u };
}

/** Dispatch on media type. Article links are always treated as plain links. */
export function getMediaEmbed(
  mediaType: MediaType | undefined,
  url?: string | null,
): MediaEmbed {
  if (mediaType === "video") return getVideoEmbed(url);
  if (mediaType === "podcast") return getPodcastEmbed(url);
  const u = clean(url);
  return u ? { kind: "link", href: u } : null;
}
