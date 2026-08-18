import { useRef, useState } from "react"

const PREVIEW_SIZE = 220
const OUTPUT_SIZE = 512

type Point = { x: number; y: number }

function clampOffset(offset: Point, zoom: number, natural: { w: number; h: number }): Point {
  if (natural.w === 0 || natural.h === 0) return offset
  const baseScale = Math.max(PREVIEW_SIZE / natural.w, PREVIEW_SIZE / natural.h)
  const scale = baseScale * zoom
  const dispW = natural.w * scale
  const dispH = natural.h * scale
  const maxX = Math.max(0, (dispW - PREVIEW_SIZE) / 2)
  const maxY = Math.max(0, (dispH - PREVIEW_SIZE) / 2)
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  }
}

export function AvatarCropper({
  imageUrl,
  onCancel,
  onConfirm,
}: {
  imageUrl: string
  onCancel: () => void
  onConfirm: (blob: Blob) => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [error, setError] = useState<string | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origin: Point } | null>(null)

  function onImageLoad() {
    const img = imgRef.current
    if (!img) return
    setNatural({ w: img.naturalWidth, h: img.naturalHeight })
  }

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: offset }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setOffset(
      clampOffset(
        { x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy },
        zoom,
        natural,
      ),
    )
  }

  function onPointerUp() {
    dragRef.current = null
  }

  function changeZoom(nextZoom: number) {
    setZoom(nextZoom)
    setOffset((prev) => clampOffset(prev, nextZoom, natural))
  }

  function confirm() {
    const img = imgRef.current
    if (!img || natural.w === 0) return
    setError(null)

    try {
      const canvas = document.createElement("canvas")
      canvas.width = OUTPUT_SIZE
      canvas.height = OUTPUT_SIZE
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        setError("Couldn't process the image — try a different photo.")
        return
      }

      const k = OUTPUT_SIZE / PREVIEW_SIZE
      const baseScale = Math.max(PREVIEW_SIZE / natural.w, PREVIEW_SIZE / natural.h)
      const scale = baseScale * zoom
      const drawW = natural.w * scale * k
      const drawH = natural.h * scale * k
      const drawX = OUTPUT_SIZE / 2 - drawW / 2 + offset.x * k
      const drawY = OUTPUT_SIZE / 2 - drawH / 2 + offset.y * k

      ctx.drawImage(img, drawX, drawY, drawW, drawH)
      canvas.toBlob((blob) => {
        if (blob) {
          onConfirm(blob)
        } else {
          setError("Couldn't save this photo — try uploading it again.")
        }
      }, "image/jpeg", 0.9)
    } catch (e) {
      setError((e as Error).message || "Couldn't save this photo — try uploading it again.")
    }
  }

  const baseScale = natural.w > 0 ? Math.max(PREVIEW_SIZE / natural.w, PREVIEW_SIZE / natural.h) : 1
  const displayScale = baseScale * zoom

  return (
    <div className="avatar-cropper">
      <p className="avatar-cropper-hint">Drag to reposition, use the slider to zoom</p>
      <div
        className="avatar-cropper-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt=""
          draggable={false}
          onLoad={onImageLoad}
          style={{
            width: natural.w * displayScale,
            height: natural.h * displayScale,
            transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
          }}
        />
      </div>
      <input
        type="range"
        min={1}
        max={3}
        step={0.01}
        value={zoom}
        onChange={(e) => changeZoom(Number(e.target.value))}
        className="avatar-cropper-zoom"
      />
      <div className="avatar-cropper-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={confirm}>
          Save
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
