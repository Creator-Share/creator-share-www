"use client"

import { useEffect, useId, useRef } from "react"

const ALLOWED_TAGS = new Set([
  "p",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "br",
  "blockquote",
])
const NON_TEXT_TAGS = new Set([
  "script",
  "style",
  "textarea",
  "option",
  "xmp",
  "noscript",
  "template",
  "head",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "svg",
  "math",
  "video",
  "audio",
  "picture",
  "canvas",
])

export type AdvocateRichTextHeading = "h2" | "h3"

export function canonicalizeAdvocateRichTextPreview(
  value: string,
  heading: AdvocateRichTextHeading,
): string {
  if (typeof document === "undefined") return value

  const source = document.createElement("template")
  source.innerHTML = value
  const output = document.createElement("div")

  function copyNode(node: Node, parent: Node, depth: number): void {
    if (depth > 32) return
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ""))
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const element = node as HTMLElement
    const sourceTag = element.tagName.toLowerCase()
    if (NON_TEXT_TAGS.has(sourceTag)) return

    const targetTag =
      sourceTag === "h1" || sourceTag === "h2" || sourceTag === "h3"
        ? heading
        : sourceTag === "b"
          ? "strong"
          : sourceTag
    if (!ALLOWED_TAGS.has(targetTag)) {
      for (const child of element.childNodes) {
        copyNode(child, parent, depth + 1)
      }
      return
    }

    const cleanElement = document.createElement(targetTag)
    parent.appendChild(cleanElement)
    if (targetTag === "br") return
    for (const child of element.childNodes) {
      copyNode(child, cleanElement, depth + 1)
    }
  }

  for (const node of source.content.childNodes) {
    copyNode(node, output, 0)
  }
  return output.innerHTML
}

const TOOLBAR_ACTIONS = Object.freeze([
  { label: "Paragraph", command: "formatBlock", value: "p" },
  { label: "Heading", command: "formatBlock", value: null },
  { label: "Bold", command: "bold", value: null },
  { label: "Italic", command: "italic", value: null },
  { label: "Bulleted list", command: "insertUnorderedList", value: null },
  { label: "Numbered list", command: "insertOrderedList", value: null },
  { label: "Quote", command: "formatBlock", value: "blockquote" },
] as const)

export function AdvocateRichTextEditor({
  label,
  description,
  value,
  heading,
  disabled,
  onChange,
}: {
  label: string
  description: string
  value: string
  heading: AdvocateRichTextHeading
  disabled: boolean
  onChange: (value: string) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const initialValue = useRef(value).current
  const labelId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const editor = editorRef.current
    if (
      editor &&
      document.activeElement !== editor &&
      editor.innerHTML !== value
    ) {
      editor.innerHTML = value
    }
  }, [value])

  function commit(resetEditor: boolean): void {
    const editor = editorRef.current
    if (!editor) return
    const canonical = canonicalizeAdvocateRichTextPreview(
      editor.innerHTML,
      heading,
    )
    onChange(canonical)
    if (resetEditor && editor.innerHTML !== canonical) {
      editor.innerHTML = canonical
    }
  }

  function runCommand(command: string, commandValue: string | null): void {
    if (disabled) return
    editorRef.current?.focus()
    const valueForCommand =
      command === "formatBlock" && commandValue === null
        ? heading
        : commandValue
    document.execCommand(command, false, valueForCommand ?? undefined)
    commit(false)
  }

  return (
    <div>
      <div id={labelId} className="text-sm font-semibold text-gray-900">
        {label}
      </div>
      <p id={descriptionId} className="mt-1 text-sm text-gray-600">
        {description}
      </p>

      <div
        role="toolbar"
        aria-label={`${label} formatting`}
        className="mt-3 flex flex-wrap gap-2 rounded-t-md border border-b-0 border-gray-300 bg-gray-50 p-2"
      >
        {TOOLBAR_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand(action.command, action.value)}
            className="min-h-9 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            {action.label}
          </button>
        ))}
      </div>

      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        aria-readonly={disabled ? "true" : undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={() => commit(false)}
        onBlur={() => commit(true)}
        onPaste={(event) => {
          if (disabled) return
          event.preventDefault()
          document.execCommand(
            "insertText",
            false,
            event.clipboardData.getData("text/plain"),
          )
          commit(false)
        }}
        onDrop={(event) => event.preventDefault()}
        className="min-h-36 rounded-b-md border border-gray-300 bg-white px-4 py-3 text-base leading-7 text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 aria-[readonly=true]:cursor-not-allowed aria-[readonly=true]:bg-gray-100 aria-[readonly=true]:text-gray-600 [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:text-lg [&_h3]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
        dangerouslySetInnerHTML={{ __html: initialValue }}
      />
    </div>
  )
}
