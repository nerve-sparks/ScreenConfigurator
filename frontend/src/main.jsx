import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

/* Load order matters: tokens define the variables, base consumes them to style
   raw elements, ui styles the primitives, and styles.css (legacy) aliases the
   old variable names onto the new tokens. */
import './tokens.css'
import './base.css'
import './tailwind.css'
import './components/ui/ui.css'
import './styles.css'

import App from './App.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'
import { ThemeProvider } from './lib/ThemeContext.jsx'
import { ToastProvider } from './components/ui/Toast.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
