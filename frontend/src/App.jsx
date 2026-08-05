import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { NotFoundPage, StudioLayout, WorkspaceLoading } from './components/StudioShell.jsx'

const AgentLibraryPage = lazy(() => import('./pages/AgentLibraryPage.jsx'))
const AgentWizardPage = lazy(() => import('./pages/AgentWizardPage.jsx'))
const BuilderPage = lazy(() => import('./pages/BuilderPage.jsx'))
const ContentBuilderPage = lazy(() => import('./pages/ContentBuilderPage.jsx'))
const PublishedAgentPage = lazy(() => import('./pages/PublishedAgentPage.jsx'))
const PublishedScreenPage = lazy(() => import('./pages/PublishedScreenPage.jsx'))

function RouteBoundary({ children }) {
  return (
    <Suspense
      fallback={
        <main className="route-state-page">
          <WorkspaceLoading message="Opening…" />
        </main>
      }
    >
      {children}
    </Suspense>
  )
}

function RedirectToWizard() {
  const { agentId } = useParams()
  return <Navigate to={`/studio/agents/${encodeURIComponent(agentId)}`} replace />
}

export default function App() {
  return (
    <Routes>
      <Route element={<StudioLayout />}>
        <Route
          path="/library"
          element={<RouteBoundary><AgentLibraryPage /></RouteBoundary>}
        />
        <Route
          path="/studio/agents/new"
          element={<RouteBoundary><AgentWizardPage /></RouteBoundary>}
        />
        <Route
          path="/studio/agents/:agentId"
          element={<RouteBoundary><AgentWizardPage /></RouteBoundary>}
        />
        <Route
          path="/studio/agents/:agentId/screens/:screenId/edit"
          element={<RouteBoundary><BuilderPage /></RouteBoundary>}
        />
        <Route
          path="/studio/agents/:agentId/screens/:screenId/content"
          element={<RouteBoundary><ContentBuilderPage /></RouteBoundary>}
        />
        <Route path="/builder/new" element={<Navigate to="/studio/agents/new" replace />} />
        <Route path="/studio/agents/:agentId/preview" element={<RedirectToWizard />} />
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
      <Route path="/" element={<Navigate to="/studio/agents/new" replace />} />
    </Routes>
  )
}
