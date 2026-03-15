import { useCallback, useEffect, useRef, useState } from 'react'
import type { APIKeyEntry, UserProfile } from '../types/user'
import * as userService from '../services/userService'

interface ProfilePageProps {
  initialProfile: UserProfile | null
  onClose: () => void
  onProfileUpdate: (profile: UserProfile) => void
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  dashscope: 'DashScope',
  aliyun: 'DashScope',
}

// ─── API Key row ────────────────────────────────────────────────────────────

interface APIKeyRowProps {
  entry: APIKeyEntry
  onSave: (provider: string, key: string) => Promise<void>
  onDelete: (provider: string) => Promise<void>
}

function APIKeyRow({ entry, onSave, onDelete }: APIKeyRowProps) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])

  const handleEdit = () => {
    setEditing(true)
    setConfirming(false)
    setError('')
    setKeyInput('')
  }

  const handleCancel = () => {
    setEditing(false)
    setConfirming(false)
    setError('')
    setKeyInput('')
  }

  const handleSave = async () => {
    const trimmed = keyInput.trim()
    if (!trimmed) {
      setError('Key must not be empty.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(entry.provider, trimmed)
      setEditing(false)
      setKeyInput('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteConfirm = async () => {
    setSaving(true)
    setError('')
    try {
      await onDelete(entry.provider)
      setConfirming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.')
    } finally {
      setSaving(false)
    }
  }

  const label = PROVIDER_LABELS[entry.provider] ?? entry.provider

  return (
    <div className="apikey-row">
      <div className="apikey-row__info">
        <span className="apikey-row__provider">{label}</span>
        {entry.is_set && entry.key_mask ? (
          <span className="apikey-row__mask">{entry.key_mask}</span>
        ) : (
          <span className="apikey-row__unset">Not set</span>
        )}
      </div>

      {editing ? (
        <div className="apikey-row__edit">
          <input
            ref={inputRef}
            type="password"
            className="apikey-row__input"
            placeholder="Paste your API key…"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') handleCancel()
            }}
            disabled={saving}
            autoComplete="off"
          />
          <div className="apikey-row__actions">
            <button
              type="button"
              className="apikey-btn apikey-btn--save"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="apikey-btn apikey-btn--cancel"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
          {error && <p className="apikey-row__error">{error}</p>}
        </div>
      ) : confirming ? (
        <div className="apikey-row__actions apikey-row__actions--confirm">
          <span className="apikey-row__confirm-text">Remove key?</span>
          <button
            type="button"
            className="apikey-btn apikey-btn--danger"
            onClick={handleDeleteConfirm}
            disabled={saving}
          >
            {saving ? '…' : 'Yes, remove'}
          </button>
          <button
            type="button"
            className="apikey-btn apikey-btn--cancel"
            onClick={() => setConfirming(false)}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="apikey-row__actions">
          <button
            type="button"
            className="apikey-btn apikey-btn--edit"
            onClick={handleEdit}
          >
            {entry.is_set ? 'Edit' : 'Set'}
          </button>
          {entry.is_set && (
            <button
              type="button"
              className="apikey-btn apikey-btn--delete"
              onClick={() => setConfirming(true)}
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ProfilePage ─────────────────────────────────────────────────────────────

export function ProfilePage({ initialProfile, onClose, onProfileUpdate }: ProfilePageProps) {
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile)
  const [apiKeys, setApiKeys] = useState<APIKeyEntry[]>([])
  const [loadingKeys, setLoadingKeys] = useState(true)

  // Account form state
  const [displayName, setDisplayName] = useState(initialProfile?.display_name ?? '')
  const [avatarUrl, setAvatarUrl] = useState(initialProfile?.avatar_url ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Fetch keys on mount
  useEffect(() => {
    userService
      .getAPIKeys()
      .then(setApiKeys)
      .catch(() => setApiKeys([]))
      .finally(() => setLoadingKeys(false))
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileSaving(true)
    setProfileMsg(null)
    try {
      const updated = await userService.updateProfile({
        display_name: displayName,
        avatar_url: avatarUrl,
      })
      setProfile(updated)
      onProfileUpdate(updated)
      setProfileMsg({ type: 'success', text: 'Profile updated.' })
    } catch (err) {
      setProfileMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save profile.',
      })
    } finally {
      setProfileSaving(false)
    }
  }

  const handleKeySave = useCallback(async (provider: string, key: string) => {
    const updated = await userService.upsertAPIKey(provider, key)
    setApiKeys((prev) =>
      prev.map((k) => (k.provider === provider ? { ...k, ...updated } : k)),
    )
  }, [])

  const handleKeyDelete = useCallback(async (provider: string) => {
    await userService.deleteAPIKey(provider)
    setApiKeys((prev) =>
      prev.map((k) => (k.provider === provider ? { provider: k.provider, is_set: false } : k)),
    )
  }, [])

  return (
    <div
      className="profile-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Profile"
      onClick={(e) => {
        // Close when clicking the backdrop (not the panel itself)
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="profile-panel">
        {/* Header */}
        <div className="profile-panel__header">
          <button
            type="button"
            className="profile-close-btn"
            onClick={onClose}
            aria-label="Close profile"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h2 className="profile-panel__title">Profile</h2>
        </div>

        <div className="profile-panel__body">
          {/* ── Account section ── */}
          <section className="profile-section">
            <h3 className="profile-section__heading">Account</h3>
            <form onSubmit={handleProfileSave} className="profile-form">
              <div className="profile-field">
                <label className="profile-field__label" htmlFor="pf-display-name">
                  Display Name
                </label>
                <input
                  id="pf-display-name"
                  type="text"
                  className="profile-field__input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How you appear to others"
                />
              </div>

              <div className="profile-field">
                <label className="profile-field__label" htmlFor="pf-email">
                  Email
                </label>
                <input
                  id="pf-email"
                  type="email"
                  className="profile-field__input profile-field__input--readonly"
                  value={profile?.email ?? ''}
                  readOnly
                  placeholder="No email set"
                  title="Email cannot be changed here"
                />
              </div>

              <div className="profile-field">
                <label className="profile-field__label" htmlFor="pf-username">
                  Username
                </label>
                <input
                  id="pf-username"
                  type="text"
                  className="profile-field__input profile-field__input--readonly"
                  value={profile?.username ?? ''}
                  readOnly
                  title="Username cannot be changed"
                />
              </div>

              <div className="profile-field">
                <label className="profile-field__label" htmlFor="pf-avatar">
                  Avatar URL
                </label>
                <input
                  id="pf-avatar"
                  type="url"
                  className="profile-field__input"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://example.com/avatar.png"
                />
              </div>

              {profileMsg && (
                <div className={`banner ${profileMsg.type === 'error' ? 'banner-error' : 'banner-success'}`}>
                  {profileMsg.text}
                </div>
              )}

              <div className="profile-form__footer">
                <button
                  type="submit"
                  className="profile-save-btn"
                  disabled={profileSaving}
                >
                  {profileSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </section>

          {/* ── API Keys section ── */}
          <section className="profile-section">
            <h3 className="profile-section__heading">API Keys</h3>
            <p className="profile-section__hint">
              Keys are encrypted at rest. Only you can use them — they are never displayed in plaintext.
            </p>

            {loadingKeys ? (
              <p className="profile-section__loading">Loading…</p>
            ) : (
              <div className="apikey-list">
                {apiKeys.map((entry) => (
                  <APIKeyRow
                    key={entry.provider}
                    entry={entry}
                    onSave={handleKeySave}
                    onDelete={handleKeyDelete}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
