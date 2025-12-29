import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Handle OAuth callback from YouTube auth popup
if (window.location.hash && window.location.hash.includes('access_token')) {
  const params = new URLSearchParams(window.location.hash.substring(1));
  const accessToken = params.get('access_token');
  const expiresIn = params.get('expires_in');
  const error = params.get('error');
  const errorDescription = params.get('error_description');

  // If this is a popup window, send message to opener and close
  if (window.opener) {
    window.opener.postMessage({
      type: 'youtube_oauth_callback',
      access_token: accessToken,
      expires_in: expiresIn ? parseInt(expiresIn) : 3600,
      error,
      error_description: errorDescription
    }, window.location.origin);
    window.close();
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);