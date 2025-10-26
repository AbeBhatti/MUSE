// Use global React and ReactDOM from CDN
// Note: These are loaded in workspace.html before this script
const { createElement: h, StrictMode } = React;
const { createRoot } = ReactDOM;

// Import the App component (which expects global React)
import App from '../dashboard.jsx';

createRoot(document.getElementById('root')).render(
  h(StrictMode, null, h(App, null))
);
