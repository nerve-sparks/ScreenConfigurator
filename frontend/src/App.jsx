import { useState } from 'react'
import FormRenderer from './FormRenderer.jsx'
import ManifestReview from './ManifestReview.jsx'
import Wizard from './Wizard.jsx'
import { generate, loadScreen, saveScreen, validateScreen } from './api.js'
import { isWizardManifest, toUiSchema } from './manifestLayout.js'
import { buildApprovedManifest, createReviewDraft } from './reviewModel.js'

export default function App() {
  const [description, setDescription] = useState('')
  const [manifest, setManifest] = useState(null)
  const [reviewDraft, setReviewDraft] = useState(null)
  // The description that actually produced the current manifest -- this,
  // not the (possibly edited) textarea value, is what gets saved with it.
  const [sourceDescription, setSourceDescription] = useState('')
  const [formKey, setFormKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [submitted, setSubmitted] = useState(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadId, setLoadId] = useState('')
  const [loadingSaved, setLoadingSaved] = useState(false)
  const [validatingReview, setValidatingReview] = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    setSubmitted(null)
    setManifest(null)
    setReviewDraft(null)
    try {
      const result = await generate(description.trim())
      if (!result?.input_schema) {
        throw new Error('Backend response is missing "input_schema".')
      }
      setReviewDraft(createReviewDraft(result))
      setSourceDescription(description.trim())
    } catch (err) {
      setManifest(null)
      setReviewDraft(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleReviewComplete = async () => {
    if (!reviewDraft) return
    setValidatingReview(true)
    setError(null)
    setNotice(null)
    setSubmitted(null)
    try {
      const candidate = buildApprovedManifest(reviewDraft)
      const validated = await validateScreen(candidate)
      setManifest(validated)
      setNotice('Review complete. The approved inputs are ready to preview.')
      // New key remounts the form so no stale field values survive.
      setFormKey((key) => key + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setValidatingReview(false)
    }
  }

  const handleReturnToReview = () => {
    if (!reviewDraft) return
    setManifest(null)
    setSubmitted(null)
    setError(null)
    setNotice(null)
  }

  const handleSave = async () => {
    if (!manifest) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await saveScreen({
        manifest,
        description: sourceDescription,
        name,
      })
      setNotice(`Saved as "${result.agent_id}" (version ${result.version}).`)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleLoad = async () => {
    const agentId = loadId.trim()
    if (!agentId) return
    setLoadingSaved(true)
    setError(null)
    setNotice(null)
    setSubmitted(null)
    try {
      const document = await loadScreen(agentId)
      if (!document?.manifest?.input_schema) {
        throw new Error('Saved screen is missing its manifest.')
      }
      setManifest(document.manifest)
      setReviewDraft(null)
      setSourceDescription(document.description ?? '')
      setDescription(document.description ?? '')
      setNotice(`Loaded "${document.agent_id}" (version ${document.version}).`)
      setFormKey((key) => key + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingSaved(false)
    }
  }

  const handleSubmit = (formData) => {
    console.log('Submitted form data:', formData)
    setSubmitted(formData)
  }

  return (
    <div className="container py-4" style={{ maxWidth: '640px' }}>
      <h1 className="h3 mb-4">Agent Screen Generator</h1>

      <div className="form-group">
        <label htmlFor="description">Describe your agent</label>
        <textarea
          id="description"
          className="form-control"
          rows={3}
          placeholder="e.g. an agent that sends an email"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn btn-primary mb-4"
        onClick={handleGenerate}
        disabled={loading || !description.trim()}
      >
        {loading ? 'Generating...' : 'Generate'}
      </button>

      <div className="form-group">
        <label htmlFor="load-id">Or load a saved screen</label>
        <div className="input-group">
          <input
            id="load-id"
            className="form-control"
            type="text"
            placeholder="agent-id, e.g. email-agent"
            value={loadId}
            onChange={(event) => setLoadId(event.target.value)}
          />
          <div className="input-group-append">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={handleLoad}
              disabled={loadingSaved || !loadId.trim()}
            >
              {loadingSaved ? 'Loading...' : 'Load'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div
          className="alert alert-danger"
          role="alert"
          style={{ whiteSpace: 'pre-line' }}
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}

      {reviewDraft && !manifest && (
        <ManifestReview
          draft={reviewDraft}
          onChange={setReviewDraft}
          onContinue={handleReviewComplete}
          continuing={validatingReview}
        />
      )}

      {manifest && (
        <>
          {reviewDraft && (
            <button
              type="button"
              className="btn btn-link px-0 mb-3"
              onClick={handleReturnToReview}
            >
              ← Back to input review
            </button>
          )}
          <div className="form-group">
            <label htmlFor="screen-name">Save this screen</label>
            <div className="input-group">
              <input
                id="screen-name"
                className="form-control"
                type="text"
                placeholder="short name, e.g. Email Agent (optional)"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <div className="input-group-append">
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
          <hr />
          {isWizardManifest(manifest) ? (
            <Wizard key={formKey} manifest={manifest} onSubmit={handleSubmit} />
          ) : (
            <FormRenderer
              key={formKey}
              schema={manifest.input_schema}
              uiSchema={toUiSchema(manifest)}
              onSubmit={handleSubmit}
            />
          )}
        </>
      )}

      {submitted !== null && (
        <pre className="bg-light border rounded p-3 mt-4">
          {JSON.stringify(submitted, null, 2)}
        </pre>
      )}
    </div>
  )
}
