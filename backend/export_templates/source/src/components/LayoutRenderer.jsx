import { createElement } from 'react'

export function ContentBlock({ block, propertiesByName = new Map() }) {
  if (block.type === 'field') {
    const property = propertiesByName.get(block.field)
    return property
      ? (
          <div className="layout-field-block" data-layout-block={block.id}>
            {property.content}
          </div>
        )
      : null
  }

  if (block.type === 'heading') {
    return createElement(
      `h${block.level}`,
      { className: 'layout-content-heading', 'data-layout-block': block.id },
      block.text,
    )
  }

  if (block.type === 'paragraph') {
    return (
      <p className="layout-content-paragraph" data-layout-block={block.id}>
        {block.text}
      </p>
    )
  }

  if (block.type === 'divider') {
    return <hr className="layout-content-divider" data-layout-block={block.id} />
  }

  if (block.type === 'callout') {
    return (
      <aside
        className={`layout-content-callout is-${block.tone}`}
        data-layout-block={block.id}
        role="note"
      >
        {block.text}
      </aside>
    )
  }

  if (block.type === 'section') {
    return (
      <section
        className="layout-content-section"
        data-layout-block={block.id}
        aria-labelledby={`${block.id}-title`}
      >
        <header>
          <h2 id={`${block.id}-title`}>{block.title}</h2>
          {block.description && <p>{block.description}</p>}
        </header>
        <div className="layout-section-body">
          {(block.children ?? []).map((child) => (
            <ContentBlock
              key={child.id}
              block={child}
              propertiesByName={propertiesByName}
            />
          ))}
        </div>
      </section>
    )
  }

  return null
}

export function ContentBlocks({ blocks = [] }) {
  const propertiesByName = new Map()
  return (
    <div className="safe-layout-blocks content-screen-blocks">
      {blocks.map((block) => (
        <ContentBlock
          key={block.id}
          block={block}
          propertiesByName={propertiesByName}
        />
      ))}
    </div>
  )
}

export function LayoutObjectFieldTemplate({ properties, blocks = [] }) {
  const propertiesByName = new Map(properties.map((property) => [
    property.name,
    property,
  ]))
  const placedFields = new Set()
  const recordFields = (items) => {
    for (const block of items) {
      if (block.type === 'field') placedFields.add(block.field)
      if (block.type === 'section') recordFields(block.children ?? [])
    }
  }
  recordFields(blocks)

  return (
    <div className="safe-layout-blocks">
      {blocks.map((block) => (
        <ContentBlock
          key={block.id}
          block={block}
          propertiesByName={propertiesByName}
        />
      ))}
      {properties
        .filter((property) => !placedFields.has(property.name))
        .map((property) => (
          <div className="layout-field-block" key={property.name}>
            {property.content}
          </div>
        ))}
    </div>
  )
}
