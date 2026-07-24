import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { NotFoundPage, StudioLayout, WorkspaceLoading } from './StudioShell.jsx'

const BuilderPage = lazy(() => import('./BuilderPage.jsx'))
const AgentCreatePage = lazy(() => import('./AgentCreatePage.jsx'))
const AgentLibraryPage = lazy(() => import('./AgentLibraryPage.jsx'))
const AgentPreviewPage = lazy(() => import('./AgentPreviewPage.jsx'))
const AgentWorkspacePage = lazy(() => import('./AgentWorkspacePage.jsx'))
const ContentBuilderPage = lazy(() => import('./ContentBuilderPage.jsx'))
const PreviewPage = lazy(() => import('./PreviewPage.jsx'))
const PublishedAgentPage = lazy(() => import('./PublishedAgentPage.jsx'))
const PublishedScreenPage = lazy(() => import('./PublishedScreenPage.jsx'))

function RouteBoundary({ children }) {
  return (
    <Suspense
      fallback={
        <main className="route-state-page">
          <WorkspaceLoading message="Opening route..." />
        </main>
      }
    >
      {children}
    </Suspense>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<StudioLayout />}>
        <Route
          path="/builder/new"
          element={<RouteBoundary><BuilderPage /></RouteBoundary>}
        />
        <Route
          path="/builder/:screenId/edit"
          element={<RouteBoundary><BuilderPage /></RouteBoundary>}
        />
        <Route
          path="/preview/:screenId"
          element={<RouteBoundary><PreviewPage /></RouteBoundary>}
        />
        <Route
          path="/library"
          element={<RouteBoundary><AgentLibraryPage /></RouteBoundary>}
        />
        <Route
          path="/studio/agents/new"
          element={<RouteBoundary><AgentCreatePage /></RouteBoundary>}
        />
        <Route
          path="/studio/agents/:agentId"
          element={<RouteBoundary><AgentWorkspacePage /></RouteBoundary>}
        />
        <Route
          path="/studio/agents/:agentId/screens/:screenId/edit"
          element={<RouteBoundary><BuilderPage /></RouteBoundary>}
        />
        <Route
          path="/studio/agents/:agentId/screens/:screenId/content"
          element={<RouteBoundary><ContentBuilderPage /></RouteBoundary>}
        />
        <Route
          path="/studio/agents/:agentId/preview"
          element={<RouteBoundary><AgentPreviewPage /></RouteBoundary>}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route
        path="/screens/:screenId"
        element={<RouteBoundary><PublishedScreenPage /></RouteBoundary>}
      />
      <Route
        path="/agents/:agentId"
        element={<RouteBoundary><PublishedAgentPage /></RouteBoundary>}
      />
      <Route path="/" element={<Navigate to="/builder/new" replace />} />
    </Routes>
  )
}
