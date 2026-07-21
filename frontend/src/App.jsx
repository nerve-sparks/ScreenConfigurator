import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { NotFoundPage, StudioLayout, WorkspaceLoading } from './StudioShell.jsx'

const BuilderPage = lazy(() => import('./BuilderPage.jsx'))
const LibraryPage = lazy(() => import('./LibraryPage.jsx'))
const PreviewPage = lazy(() => import('./PreviewPage.jsx'))
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
          element={<RouteBoundary><LibraryPage /></RouteBoundary>}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route
        path="/screens/:screenId"
        element={<RouteBoundary><PublishedScreenPage /></RouteBoundary>}
      />
      <Route path="/" element={<Navigate to="/builder/new" replace />} />
    </Routes>
  )
}
