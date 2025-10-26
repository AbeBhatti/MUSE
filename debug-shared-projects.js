// Debug script for "Shared with Me" issue
// Copy and paste this entire script into your browser console on the index.html page

(async function debugSharedProjects() {
  console.log('=== DEBUGGING SHARED PROJECTS ===\n');

  // 1. Check logged in user
  const token = localStorage.getItem('idToken');
  if (!token) {
    console.error('❌ No token found - you are not logged in!');
    return;
  }

  const payload = JSON.parse(atob(token.split('.')[1]));
  console.log('1. LOGGED IN USER:');
  console.log('   User ID:', payload.sub);
  console.log('   Email:', payload.email);
  console.log('');

  // 2. Fetch projects from API
  console.log('2. FETCHING PROJECTS FROM API...');
  const API_BASE = window.BACKEND_URL || '';
  const url = `${API_BASE}/api/projects/user/${payload.sub}`;
  console.log('   URL:', url);

  try {
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      console.error('   ❌ API Error:', response.status, response.statusText);
      const errorData = await response.json().catch(() => ({}));
      console.error('   Error details:', errorData);
      return;
    }

    const projects = await response.json();
    console.log('   ✅ Received', projects.length, 'projects');
    console.log('');

    // 3. Analyze projects
    console.log('3. ANALYZING PROJECTS:');

    const ownedProjects = [];
    const sharedProjects = [];
    const deletedProjects = [];

    projects.forEach((project, index) => {
      const isOwner = project.ownerId === payload.sub || project.userRole === 'owner';
      const isDeleted = project.deleted === true;

      console.log(`   Project ${index + 1}:`);
      console.log(`      Name: "${project.name}"`);
      console.log(`      ID: ${project.projectId}`);
      console.log(`      Owner ID: ${project.ownerId}`);
      console.log(`      User Role: ${project.userRole || 'MISSING!'}`);
      console.log(`      Deleted: ${isDeleted}`);
      console.log(`      Is Owner: ${isOwner}`);
      console.log(`      Should show in "Shared with Me": ${!isOwner && !isDeleted}`);
      console.log('');

      if (isDeleted) {
        deletedProjects.push(project);
      } else if (isOwner) {
        ownedProjects.push(project);
      } else {
        sharedProjects.push(project);
      }
    });

    // 4. Summary
    console.log('4. SUMMARY:');
    console.log(`   📁 My Projects: ${ownedProjects.length}`);
    console.log(`   🤝 Shared with Me: ${sharedProjects.length}`);
    console.log(`   🗑️  Trash: ${deletedProjects.length}`);
    console.log('');

    if (sharedProjects.length > 0) {
      console.log('   ✅ SHARED PROJECTS FOUND:');
      sharedProjects.forEach(p => {
        console.log(`      - "${p.name}" (${p.projectId})`);
        console.log(`        Role: ${p.userRole}`);
      });
    } else {
      console.log('   ❌ NO SHARED PROJECTS FOUND');
      console.log('');
      console.log('   TROUBLESHOOTING:');
      console.log('   - Check if userRole field is present in all projects');
      console.log('   - Verify you are logged in as the correct account');
      console.log('   - Try refreshing the page (Ctrl+Shift+R / Cmd+Shift+R)');
    }

    console.log('\n=== DEBUG COMPLETE ===');

    return {
      userId: payload.sub,
      email: payload.email,
      totalProjects: projects.length,
      owned: ownedProjects,
      shared: sharedProjects,
      deleted: deletedProjects
    };

  } catch (error) {
    console.error('❌ FETCH ERROR:', error);
  }
})();
