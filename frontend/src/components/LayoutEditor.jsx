import { useEffect, useMemo, useState } from 'react'
import {
  approveLayout,
  addContentBlock,
  deleteContentBlock,
  editContentBlock,
  relocateLayoutBlock,
  reorderLayoutBlock,
} from '../lib/reviewModel.js'
import {
  blockLocation,
  layoutBlockById,
  layoutRoots,
} from '../lib/layoutBlocks.js'

const BLOCK_OPTIONS = [
  { type: 'heading', label: 'Heading' },
  { type: 'paragraph', label: 'Paragraph' },
  { type: 'section', label: 'Section' },
  { type: 'divider', label: 'Divider' },
  { type: 'callout', label: 'Callout' },
]

const IGNORE_GROUP_CHANGE = () => {}

function blockLabel(block, manifest) {
  if (block.type === 'field') {
    return manifest.input_schema.properties?.[block.field]?.title ?? block.field
  }
  if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'callout') {
    return block.text
  }
  if (block.type === 'section') return block.title
  return 'Divider'
}

function BlockTree({ blocks, manifest, selectedId, onSelect, depth = 0 }) {
  return (
    <ol className={`layout-editor-list ${depth ? 'is-nested' : ''}`}>
      {blocks.map((block) => (
        <li key={block.id}>
          <button
            type="button"
            className={`layout-editor-card ${selectedId === block.id ? 'is-selected' : ''}`}
            onClick={() => onSelect(block.id)}
            aria-pressed={selectedId === block.id}
          >
            <span className="layout-editor-type">{block.type}</span>
            <strong>{blockLabel(block, manifest)}</strong>
            {block.type === 'field' && <small>{block.field}</small>}
          </button>
          {block.type === 'section' && (
            <BlockTree
              blocks={block.children ?? []}
              manifest={manifest}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ol>
  )
}

function TextProperty({
  id,
  label,
  value,
  onChange,
  maxLength,
  multiline = false,
  disabled,
}) {
  const Component = multiline ? 'textarea' : 'input'
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <Component
        id={id}
        className="form-control"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        rows={multiline ? 4 : undefined}
        disabled={disabled}
        required
      />
      <small>{value.length}/{maxLength}</small>
    </div>
  )
}

function BlockPropertyEditor({ block, onSave, disabled }) {
  const [text, setText] = useState(block.text ?? '')
  const [level, setLevel] = useState(block.level ?? 2)
  const [tone, setTone] = useState(block.tone ?? 'information')
  const [title, setTitle] = useState(block.title ?? '')
  const [description, setDescription] = useState(block.description ?? '')

  if (block.type === 'field') {
    return (
      <p>
        This field is controlled by Input fields. You can position it here,
        but edit or remove it from the field review.
      </p>
    )
  }

  if (block.type === 'divider') {
    return <p>A divider has no editable text or styling.</p>
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (block.type === 'heading') {
      if (!text.trim()) return
      onSave({ text: text.trim(), level })
    }
    if (block.type === 'paragraph') {
      if (!text.trim()) return
      onSave({ text: text.trim() })
    }
    if (block.type === 'callout') {
      if (!text.trim()) return
      onSave({ text: text.trim(), tone })
    }
    if (block.type === 'section') {
      if (!title.trim()) return
      onSave({
        title: title.trim(),
        description: description.trim() || null,
      })
    }
  }

  return (
    <form className="layout-property-form" onSubmit={handleSubmit}>
      {block.type === 'heading' && (
        <>
          <TextProperty
            id={`block-text-${block.id}`}
            label="Heading text"
            value={text}
            onChange={setText}
            maxLength={120}
            disabled={disabled}
          />
          <div className="form-group">
            <label htmlFor={`block-level-${block.id}`}>Heading level</label>
            <select
              id={`block-level-${block.id}`}
              className="form-control"
              value={level}
              onChange={(event) => setLevel(Number(event.target.value))}
              disabled={disabled}
            >
              <option value={2}>Heading 2</option>
              <option value={3}>Heading 3</option>
              <option value={4}>Heading 4</option>
            </select>
          </div>
        </>
      )}
      {block.type === 'paragraph' && (
        <TextProperty
          id={`block-text-${block.id}`}
          label="Paragraph text"
          value={text}
          onChange={setText}
          maxLength={1000}
          multiline
          disabled={disabled}
        />
      )}
      {block.type === 'callout' && (
        <>
          <TextProperty
            id={`block-text-${block.id}`}
            label="Callout text"
            value={text}
            onChange={setText}
            maxLength={1000}
            multiline
            disabled={disabled}
          />
          <div className="form-group">
            <label htmlFor={`block-tone-${block.id}`}>Tone</label>
            <select
              id={`block-tone-${block.id}`}
              className="form-control"
              value={tone}
              onChange={(event) => setTone(event.target.value)}
              disabled={disabled}
            >
              <option value="information">Information</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
            </select>
          </div>
        </>
      )}
      {block.type === 'section' && (
        <>
          <TextProperty
            id={`block-title-${block.id}`}
            label="Section title"
            value={title}
            onChange={setTitle}
            maxLength={80}
            disabled={disabled}
          />
          <TextProperty
            id={`block-description-${block.id}`}
            label="Section description"
            value={description}
            onChange={setDescription}
            maxLength={240}
            multiline
            disabled={disabled}
          />
        </>
      )}
      <button type="submit" className="btn btn-primary" disabled={disabled}>
        Save block
      </button>
    </form>
  )
}

function BlockInspector({
  block,
  location,
  roots,
  onChange,
  disabled,
}) {
  if (!block || !location) {
    return (
      <aside className="layout-block-inspector">
        <span className="section-kicker">Block properties</span>
        <h3>No block selected</h3>
        <p>Select a content or field block to inspect its safe properties.</p>
      </aside>
    )
  }

  const root = roots.find((entry) => entry.groupId === location.groupId)
  const container = location.sectionId
    ? root?.blocks.find((item) => item.id === location.sectionId)?.children ?? []
    : root?.blocks ?? []
  const rootSections = (root?.blocks ?? []).filter((item) => item.type === 'section')

  return (
    <aside className="layout-block-inspector" aria-label="Selected layout block properties">
      <span className="section-kicker">Block properties</span>
      <h3>{block.type === 'field' ? 'Input field' : block.type}</h3>
      <code>{block.id}</code>

      <BlockPropertyEditor
        key={block.id}
        block={block}
        onSave={(changes) => onChange((current) =>
          editContentBlock(current, block.id, changes))}
        disabled={disabled}
      />

      <div className="layout-block-actions" aria-label="Block position controls">
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => onChange((current) => reorderLayoutBlock(current, block.id, -1))}
          disabled={disabled || location.index === 0}
        >
          Move up
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => onChange((current) => reorderLayoutBlock(current, block.id, 1))}
          disabled={disabled || location.index === container.length - 1}
        >
          Move down
        </button>
      </div>

      {block.type !== 'section' && (
        <div className="form-group">
          <label htmlFor={`block-parent-${block.id}`}>Place in</label>
          <select
            id={`block-parent-${block.id}`}
            className="form-control"
            value={location.sectionId ?? ''}
            onChange={(event) => onChange((current) =>
              relocateLayoutBlock(current, block.id, event.target.value || null))}
            disabled={disabled}
          >
            <option value="">Step root</option>
            {rootSections.map((section) => (
              <option key={section.id} value={section.id}>{section.title}</option>
            ))}
          </select>
        </div>
      )}

      {block.type !== 'field' && (
        <button
          type="button"
          className="btn btn-outline-danger"
          onClick={() => onChange((current) => deleteContentBlock(current, block.id))}
          disabled={disabled}
        >
          {block.type === 'section' ? 'Delete section and keep its children' : 'Remove block'}
        </button>
      )}
    </aside>
  )
}

export default function LayoutEditor({
  draft,
  onChange,
  disabled = false,
  activeGroupId = null,
  onActiveGroupChange = IGNORE_GROUP_CHANGE,
  showApproval = true,
}) {
  const roots = useMemo(() => layoutRoots(draft.manifest), [draft.manifest])
  const [selectedId, setSelectedId] = useState(null)
  const activeRoot = roots.find((root) => root.groupId === activeGroupId) ?? roots[0]
  const selectedBlock = selectedId
    ? layoutBlockById(draft.manifest, selectedId)
    : null
  const selectedLocation = selectedId
    ? blockLocation(draft.manifest, selectedId)
    : null

  useEffect(() => {
    if (!roots.some((root) => root.groupId === activeGroupId)) {
      onActiveGroupChange(roots[0]?.groupId ?? null)
    }
  }, [activeGroupId, onActiveGroupChange, roots])

  useEffect(() => {
    setSelectedId(null)
  }, [activeRoot?.groupId])

  useEffect(() => {
    if (selectedId && !layoutBlockById(draft.manifest, selectedId)) {
      setSelectedId(null)
    }
  }, [draft.manifest, selectedId])

  const addBlock = (type) => {
    onChange((current) => addContentBlock(current, type, activeRoot?.groupId ?? null))
  }

  return (
    <section id="content-layout" className="layout-editor-section" aria-labelledby="layout-editor-title">
      <header className="layout-editor-header">
        <div>
          <span className="section-kicker">Content &amp; layout</span>
          <h2 id="layout-editor-title">Arrange the screen safely</h2>
          <p>Mix helpful content with approved inputs. HTML, scripts, and custom CSS are not accepted.</p>
        </div>
        {showApproval && (
          <div className="layout-approval">
            <span className={`badge ${draft.layoutApproved ? 'badge-success' : 'badge-info'}`}>
              {draft.layoutApproved ? 'Layout approved' : 'AI suggested'}
            </span>
            <button
              type="button"
              className="btn btn-success"
              onClick={() => onChange((current) => approveLayout(current))}
              disabled={disabled || draft.layoutApproved}
            >
              Approve layout
            </button>
          </div>
        )}
      </header>

      {roots.length > 1 && (
        <div className="layout-root-tabs" role="tablist" aria-label="Wizard layout steps">
          {roots.map((root) => (
            <button
              key={root.groupId}
              type="button"
              role="tab"
              aria-selected={root.groupId === activeRoot?.groupId}
              className={root.groupId === activeRoot?.groupId ? 'is-active' : ''}
              onClick={() => {
                onActiveGroupChange(root.groupId)
                setSelectedId(null)
              }}
            >
              {root.label}
            </button>
          ))}
        </div>
      )}

      <div className="layout-editor-palette" aria-label="Add content block">
        <strong>Add block</strong>
        {BLOCK_OPTIONS.map((option) => (
          <button
            key={option.type}
            type="button"
            className="btn btn-outline-primary"
            onClick={() => addBlock(option.type)}
            disabled={disabled}
          >
            + {option.label}
          </button>
        ))}
      </div>

      <div className="layout-editor-workspace">
        <div className="layout-block-outline">
          <h3>{activeRoot?.label ?? 'Screen layout'}</h3>
          <BlockTree
            blocks={activeRoot?.blocks ?? []}
            manifest={draft.manifest}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <BlockInspector
          block={selectedBlock}
          location={selectedLocation}
          roots={roots}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {draft.layoutApproved
          ? 'Content and layout approved.'
          : 'Content and layout requires approval.'}
      </p>
    </section>
  )
}
