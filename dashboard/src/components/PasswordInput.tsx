import { useState } from "react"

import { EyeIcon, EyeOffIcon } from "./icons"

export function PasswordInput({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="password-input">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="current-password"
      />
      <button
        type="button"
        className="password-input-toggle"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible(!visible)}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}
