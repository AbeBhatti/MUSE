/**
 * Instrument Dashboard
 * Handles instrument selection and routing to appropriate editors
 */

(function() {
  'use strict';

  // Get project information from URL params or localStorage
  function getProjectInfo() {
    const urlParams = new URLSearchParams(window.location.search);
    return {
      projectId: urlParams.get('projectId') || localStorage.getItem('currentProjectId') || 'new-project',
      projectName: urlParams.get('projectName') || localStorage.getItem('currentProjectName') || 'New Project'
    };
  }

  // Initialize dashboard on page load
  document.addEventListener('DOMContentLoaded', () => {
    const projectInfo = getProjectInfo();

    // Update project name display
    const projectNameEl = document.getElementById('projectName');
    if (projectNameEl) {
      projectNameEl.textContent = projectInfo.projectName;
    }

    // Store project info in localStorage for access from other pages
    localStorage.setItem('currentProjectId', projectInfo.projectId);
    localStorage.setItem('currentProjectName', projectInfo.projectName);
  });

  /**
   * Navigate back to projects list
   */
  window.goBackToProjects = function() {
    window.location.href = 'index.html';
  };

  /**
   * Handle instrument selection
   * @param {string} instrument - The selected instrument type
   */
  window.selectInstrument = function(instrument) {
    const projectInfo = getProjectInfo();

    // Store the selected instrument
    localStorage.setItem('selectedInstrument', instrument);

    // For now, all instruments route to the MIDI editor
    // In the future, you can create specialized editors for each instrument
    const editorUrl = `midi-editor.html?projectId=${encodeURIComponent(projectInfo.projectId)}&projectName=${encodeURIComponent(projectInfo.projectName)}&instrument=${instrument}`;

    window.location.href = editorUrl;
  };

  /**
   * Handle Add Audio File option
   * Routes to MIDI editor with audio upload mode
   */
  window.addAudioFile = function() {
    const projectInfo = getProjectInfo();

    // Set a flag to auto-open the audio upload dialog
    localStorage.setItem('autoOpenAudioUpload', 'true');
    localStorage.setItem('selectedInstrument', 'audio');

    const editorUrl = `midi-editor.html?projectId=${encodeURIComponent(projectInfo.projectId)}&projectName=${encodeURIComponent(projectInfo.projectName)}&mode=audio`;

    window.location.href = editorUrl;
  };

  /**
   * Return to dashboard from editor
   * This function can be called from the MIDI editor after saving
   */
  window.returnToDashboard = function() {
    const projectInfo = getProjectInfo();
    const dashboardUrl = `dashboard.html?projectId=${encodeURIComponent(projectInfo.projectId)}&projectName=${encodeURIComponent(projectInfo.projectName)}`;

    window.location.href = dashboardUrl;
  };

})();
