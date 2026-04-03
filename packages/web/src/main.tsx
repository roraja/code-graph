import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApolloClient, InMemoryCache, ApolloProvider } from '@apollo/client';
import { App } from './App';

/**
 * Apollo Client instance configured to connect to the CodeGraph GraphQL API.
 * The URI is proxied through Vite to the backend at localhost:3000.
 */
const apolloClient = new ApolloClient({
  uri: '/graphql',
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network' },
  },
});

/** Global CSS reset applied via a style element. */
const globalCSS = `
  *, *::before, *::after {
    box-sizing: border-box;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #0d0d1a;
    color: #e0e0e0;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: #0d0d1a;
  }
  ::-webkit-scrollbar-thumb {
    background: #2d2d44;
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: #3d3d5c;
  }
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type="number"] {
    -moz-appearance: textfield;
  }
`;

/**
 * Application entry point.
 * Mounts the React app with Apollo GraphQL provider and React Router.
 */
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

const styleEl = document.createElement('style');
styleEl.textContent = globalCSS;
document.head.appendChild(styleEl);

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ApolloProvider client={apolloClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ApolloProvider>
  </React.StrictMode>
);
