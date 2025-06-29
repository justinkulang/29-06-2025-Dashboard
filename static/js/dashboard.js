const API_BASE_URL = ''; // Same origin
let currentUsers = [];
let currentProfiles = [];
let currentSessions = [];
let lastGeneratedBatchCredentials = []; // To store the last batch of generated credentials
let analyticsDataLoaded = false; // Flag for initial analytics load

const logger = { // Simple logger
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug
};

// --- Toast Notification System ---
function showToast(type, message) {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
        console.error('Toast container not found!');
        return;
    }

    const toast = document.createElement('div');
    toast.classList.add('toast', type);

    let iconClass = '';
    switch (type) {
        case 'success': iconClass = 'fas fa-check-circle'; break;
        case 'danger': iconClass = 'fas fa-times-circle'; break;
        case 'warning': iconClass = 'fas fa-exclamation-triangle'; break;
        case 'info': iconClass = 'fas fa-info-circle'; break;
    }

    toast.innerHTML = `
        <i class="toast-icon ${iconClass}"></i>
        <div class="toast-message">${message}</div>
        <button class="toast-close-button">&times;</button>
    `;

    toastContainer.appendChild(toast);

    // Force reflow to ensure animation starts from the correct position
    void toast.offsetWidth;

    // Remove toast after animation (3 seconds total: 0.5s slideIn + 2s display + 0.5s fadeOut)
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.5s forwards'; // Ensure fadeOut plays
        toast.addEventListener('animationend', (event) => {
            if (event.animationName === 'fadeOut') {
                toast.remove();
            }
        });
    }, 3000); // Start fadeOut after 2.5s (slideIn 0.5s + display 2s)

    toast.querySelector('.toast-close-button').addEventListener('click', () => {
        toast.style.animation = 'fadeOut 0.5s forwards';
        toast.addEventListener('animationend', (event) => {
            if (event.animationName === 'fadeOut') {
                toast.remove();
            }
        });
    });
}

// --- Custom Confirmation Modal ---
let confirmActionCallback = null;

function showConfirmationModal(message, callback) {
    const modal = document.getElementById('confirmationModal');
    const messageEl = document.getElementById('confirmationModalMessage');
    const confirmButton = document.getElementById('confirmActionButton');

    messageEl.textContent = message;
    confirmActionCallback = callback; // Store the callback

    confirmButton.onclick = () => {
        if (confirmActionCallback) {
            confirmActionCallback(true); // Execute callback with true for confirmation
        }
        closeModal('confirmationModal');
    };

    openModal('confirmationModal');
}

function apiCall(endpoint, options = {}, suppressSpinner = false) {
    if (!suppressSpinner) {
        showGlobalSpinner(true);
    }

    return fetch(endpoint, options)
        .then(response => {
            if (response.ok) {
                return response.json();
            }
            // Handle HTTP errors
            return response.json().then(err => {
                showToast('danger', 'API Error: ' + (err.message || response.statusText));
                throw new Error(err.message || 'API call failed');
            });
        })
        .then(data => {
            if (data.status === 'error') {
                showToast('danger', 'Operation failed: ' + data.message);
                throw new Error(data.message);
            }
            if (data.status === 'success' && data.message) {
                // Use showToast instead of showAlert for success messages
                showToast('success', data.message);
            }
            return data;
        })
        .catch(error => {
            logger.error('API call error:', error);
            // showToast('danger', 'An unexpected error occurred.'); // General error toast if not already handled
            throw error; // Re-throw to propagate the error
        })
        .finally(() => {
            if (!suppressSpinner) {
                showGlobalSpinner(false);
            }
        });
}

// --- Helper Functions (Updated) ---

function showAlert(elementId, type, message) {
    // This function is now deprecated in favor of showToast, but kept for compatibility
    // if there are any direct calls that haven't been migrated yet.
    showToast(type, message);
}


function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function showGlobalSpinner(show) {
    const statusEl = document.getElementById('connectionStatus');
    if (show) {
        statusEl.classList.remove('connected', 'disconnected');
        statusEl.innerHTML = '<i class="loading-spinner"></i><span>Connecting...</span>';
    } else {
        // Assume connected state if spinner is hidden. Update based on actual connection status.
        statusEl.classList.add('connected');
        statusEl.classList.remove('disconnected');
        statusEl.innerHTML = '<i class="fas fa-check-circle"></i><span>Connected</span>';
    }
}

function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || bytes === '' || isNaN(bytes)) return 'Unlimited';
    const numBytes = Number(bytes);
    if (numBytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(numBytes) / Math.log(k));
    return `${parseFloat((numBytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// Function to populate a table using a template
function populateTableFromTemplate(tableBodyId, templateId, data, rowMapper) {
    const tableBody = document.getElementById(tableBodyId);
    const rowTemplate = document.getElementById(templateId);

    if (!tableBody || !rowTemplate) {
        logger.error(`Table body (${tableBodyId}) or template (${templateId}) not found.`);
        return;
    }

    tableBody.innerHTML = ''; // Clear existing rows

    if (!data || data.length === 0) {
        const colspan = tableBody.previousElementSibling.querySelector('tr').children.length;
        tableBody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center;">No data available.</td></tr>`;
        return;
    }

    data.forEach(item => {
        const row = rowTemplate.content.cloneNode(true);
        rowMapper(row, item); // Use the provided mapper function to populate fields
        tableBody.appendChild(row);
    });
}

// --- Specific Data Loading and Display Functions (Refactored with templates) ---

async function loadUsers() {
    showGlobalSpinner(true);
    try {
        const data = await apiCall('/api/users');
        currentUsers = data.users || [];
        currentProfiles = data.profiles || []; // Assume profiles come with users
        populateProfileFilters();
        filterAndDisplayUsers(); // Filter and display users after loading
    } catch (error) {
        logger.error("Failed to load users:", error);
        showToast('danger', 'Failed to load users.');
        document.getElementById('usersTable').querySelector('tbody').innerHTML = `<tr><td colspan="9" style="text-align: center;">Error loading users.</td></tr>`;
    } finally {
        showGlobalSpinner(false);
    }
}

function populateProfileFilters() {
    const userFilterProfile = document.getElementById('userFilterProfile');
    const exportProfileFilter = document.getElementById('exportProfileFilter');
    const createProfileSelect = document.getElementById('profile');
    const bulkProfileSelect = document.getElementById('bulkProfile');
    const editProfileSelect = document.getElementById('editProfile');
    const deleteByProfileSelect = document.getElementById('deleteByProfileSelect');

    [userFilterProfile, exportProfileFilter, createProfileSelect, bulkProfileSelect, editProfileSelect, deleteByProfileSelect].forEach(select => {
        if (select) {
            select.innerHTML = '<option value="">All Profiles</option>'; // Default option
        }
    });

    currentProfiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = profile.name;
        option.textContent = profile.name;

        // Clone for each select element
        if (userFilterProfile) userFilterProfile.appendChild(option.cloneNode(true));
        if (exportProfileFilter) exportProfileFilter.appendChild(option.cloneNode(true));
        if (createProfileSelect) createProfileSelect.appendChild(option.cloneNode(true));
        if (bulkProfileSelect) bulkProfileSelect.appendChild(option.cloneNode(true));
        if (editProfileSelect) editProfileSelect.appendChild(option.cloneNode(true));
        if (deleteByProfileSelect) deleteByProfileSelect.appendChild(option.cloneNode(true));
    });
}


function filterAndDisplayUsers() {
    const searchTerm = document.getElementById('userSearchInput').value.toLowerCase();
    const filterProfile = document.getElementById('userFilterProfile').value;
    const filterStatus = document.getElementById('userFilterStatus').value;

    const filteredUsers = currentUsers.filter(user => {
        const matchesSearch = searchTerm === '' ||
                              user.username.toLowerCase().includes(searchTerm) ||
                              (user.comment && user.comment.toLowerCase().includes(searchTerm));
        const matchesProfile = filterProfile === '' || user.profile === filterProfile;
        const matchesStatus = filterStatus === '' ||
                              (filterStatus === 'active' && user.active) ||
                              (filterStatus === 'disabled' && !user.active);
        return matchesSearch && matchesProfile && matchesStatus;
    });

    populateTableFromTemplate('usersTable', 'userRowTemplate', filteredUsers, (row, user) => {
        row.querySelector('[data-field="username"]').textContent = user.username;
        row.querySelector('[data-field="profile"]').textContent = user.profile;
        
        const statusBadge = row.querySelector('[data-field="status-badge"]');
        if (user.active) {
            statusBadge.textContent = 'Active';
            statusBadge.classList.add('status-active');
            statusBadge.classList.remove('status-disabled');
        } else {
            statusBadge.textContent = 'Disabled';
            statusBadge.classList.add('status-disabled');
            statusBadge.classList.remove('status-active');
        }

        row.querySelector('[data-field="timeLimit"]').textContent = user['time-limit'] || 'Unlimited';
        row.querySelector('[data-field="dataLimit"]').textContent = user['data-limit'] ? formatBytes(user['data-limit']) : 'Unlimited';
        row.querySelector('[data-field="uptime"]').textContent = user.uptime || '0s';
        row.querySelector('[data-field="dataUsed"]').textContent = user['bytes-in'] && user['bytes-out'] ? formatBytes(user['bytes-in'] + user['bytes-out']) : '0 B';
        row.querySelector('[data-field="comment"]').textContent = user.comment || '';

        const editButton = row.querySelector('.edit-user-btn');
        if (editButton) {
            editButton.onclick = () => openEditUserModal(user);
        }
        const deleteButton = row.querySelector('.delete-user-btn');
        if (deleteButton) {
            deleteButton.onclick = () => deleteUser(user.username);
        }
    });
    // Update total user count for dashboard
    document.getElementById('totalUsers').textContent = currentUsers.length;
}

async function loadActiveSessions() {
    showGlobalSpinner(true);
    try {
        const data = await apiCall('/api/sessions');
        currentSessions = data.sessions || [];
        populateTableFromTemplate('sessionsTable', 'sessionRowTemplate', currentSessions, (row, session) => {
            row.querySelector('[data-field="username"]').textContent = session.username;
            row.querySelector('[data-field="ipAddress"]').textContent = session['host-ip'];
            row.querySelector('[data-field="macAddress"]').textContent = session['mac-address'];
            row.querySelector('[data-field="uptime"]').textContent = session.uptime;
            row.querySelector('[data-field="dataUsage"]').textContent = formatBytes(session['bytes-in'] + session['bytes-out']);
            row.querySelector('[data-field="timeLeft"]').textContent = session['time-left'] || 'N/A';

            const disconnectButton = row.querySelector('.disconnect-session-btn');
            if (disconnectButton) {
                disconnectButton.onclick = () => disconnectUser(session.username);
            }
        });
        document.getElementById('activeSessions').textContent = currentSessions.length;
    } catch (error) {
        logger.error("Failed to load active sessions:", error);
        showToast('danger', 'Failed to load active sessions.');
        document.getElementById('sessionsTable').querySelector('tbody').innerHTML = `<tr><td colspan="7" style="text-align: center;">Error loading sessions.</td></tr>`;
    } finally {
        showGlobalSpinner(false);
    }
}

async function loadProfiles() {
    showGlobalSpinner(true);
    try {
        const data = await apiCall('/api/profiles');
        currentProfiles = data.profiles || [];
        populateTableFromTemplate('profilesTable', 'profileRowTemplate', currentProfiles, (row, profile) => {
            row.querySelector('[data-field="name"]').textContent = profile.name;
            row.querySelector('[data-field="rateLimit"]').textContent = profile['rate-limit'] || 'N/A';
            row.querySelector('[data-field="sessionTimeout"]').textContent = profile['session-timeout'] || 'N/A';
            row.querySelector('[data-field="sharedUsers"]').textContent = profile['shared-users'] || 'N/A';

            const editButton = row.querySelector('.edit-profile-btn');
            if (editButton) {
                editButton.onclick = () => openProfileModal(profile);
            }
            const deleteButton = row.querySelector('.delete-profile-btn');
            if (deleteButton) {
                deleteButton.onclick = () => deleteProfile(profile.name);
            }
        });
    } catch (error) {
        logger.error("Failed to load profiles:", error);
        showToast('danger', 'Failed to load profiles.');
        document.getElementById('profilesTable').querySelector('tbody').innerHTML = `<tr><td colspan="5" style="text-align: center;">Error loading profiles.</td></tr>`;
    } finally {
        showGlobalSpinner(false);
    }
}


async function loadAnalyticsData() {
    showGlobalSpinner(true);
    try {
        const data = await apiCall('/api/analytics');
        const analytics = data.analytics || {};

        document.getElementById('analyticsTotalData').textContent = 'Total Data Transferred: ' + formatBytes(analytics.total_data_transferred);

        // Top Users by Data Usage
        const topUsersTableBody = document.getElementById('analyticsTopUsersTable').querySelector('tbody');
        if (analytics.top_users && analytics.top_users.length > 0) {
             populateTableFromTemplate('analyticsTopUsersTable', 'topUserAnalyticsRowTemplate', analytics.top_users, (row, user, index) => {
                row.querySelector('[data-field="index"]').textContent = index + 1;
                row.querySelector('[data-field="username"]').textContent = user.username;
                row.querySelector('[data-field="profile"]').textContent = user.profile;
                row.querySelector('[data-field="upload"]').textContent = formatBytes(user.upload);
                row.querySelector('[data-field="download"]').textContent = formatBytes(user.download);
                row.querySelector('[data-field="totalData"]').textContent = formatBytes(user.total_data);
                row.querySelector('[data-field="comment"]').textContent = user.comment || '';
             });
        } else {
            topUsersTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No top user data available.</td></tr>`;
        }

        // Data Usage by Profile
        const profileUsageTableBody = document.getElementById('analyticsProfileUsageTable').querySelector('tbody');
        if (analytics.profile_usage && Object.keys(analytics.profile_usage).length > 0) {
            const sortedProfiles = Object.entries(analytics.profile_usage).sort(([, a], [, b]) => b - a); // Sort by total usage descending
            populateTableFromTemplate('analyticsProfileUsageTable', 'profileUsageAnalyticsRowTemplate', sortedProfiles, (row, [profileName, totalUsage]) => {
                row.querySelector('[data-field="profileName"]').textContent = profileName;
                row.querySelector('[data-field="totalUsage"]').textContent = formatBytes(totalUsage);
            });
        } else {
            profileUsageTableBody.innerHTML = `<tr><td colspan="2" style="text-align:center;">No profile usage data available.</td></tr>`;
        }
    } catch (error) {
        logger.error("Failed to load analytics data:", error);
        showToast('danger', 'Failed to load analytics data.');
        document.getElementById('analyticsTotalData').textContent = 'Total Data Transferred: Error loading data';
        document.getElementById('analyticsTopUsersTable').querySelector('tbody').innerHTML = `<tr><td colspan="7" style="text-align:center;">Could not load top user data.</td></tr>`;
        document.getElementById('analyticsProfileUsageTable').querySelector('tbody').innerHTML = `<tr><td colspan="2" style="text-align:center;">Could not load profile usage data.</td></tr>`;
    } finally {
        showGlobalSpinner(false);
    }
}


// --- Init & Navigation ---
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const tabName = link.dataset.tab;

            if (tabName === 'analytics' && !analyticsDataLoaded) {
                loadAnalyticsData();
                analyticsDataLoaded = true;
            }
            
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.getElementById(tabName).classList.add('active');
            
            document.getElementById('pageTitle').textContent = link.querySelector('span').textContent;
        });
    });
    
    // Initial load
    init();
    
    // Setup filter listeners
    document.getElementById('userSearchInput').addEventListener('input', () => filterAndDisplayUsers());
    document.getElementById('userFilterProfile').addEventListener('change', () => filterAndDisplayUsers());
    document.getElementById('userFilterStatus').addEventListener('change', () => filterAndDisplayUsers());

    // Setup Maintenance button listeners
    const deleteByProfileBtn = document.getElementById('deleteByProfileButton');
    if (deleteByProfileBtn) {
        deleteByProfileBtn.addEventListener('click', handleDeleteUsersByProfile);
    }

    const deleteByStatusBtn = document.getElementById('deleteByStatusButton');
    if (deleteByStatusBtn) {
        deleteByStatusBtn.addEventListener('click', handleDeleteUsersByStatus);
    }
    
    // Setup form submissions
    document.getElementById('configForm').addEventListener('submit', handleConfigSave);
    document.getElementById('createUserForm').addEventListener('submit', handleCreateUser);
    document.getElementById('bulkCreateUserForm').addEventListener('submit', handleBulkCreateUsers);
    document.getElementById('editUserForm').addEventListener('submit', handleEditUser);
    document.getElementById('profileForm').addEventListener('submit', handleProfileSave);

    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) {
        logoutButton.addEventListener('click', async function(event) {
            event.preventDefault();
            showConfirmationModal('Are you sure you want to logout?', async (confirmed) => {
                if (confirmed) {
                    showGlobalSpinner(true); // Show spinner during API call
                    try {
                        const result = await apiCall('/logout', { method: 'POST' });
                        if (result && result.success) {
                            window.location.href = '/'; // Redirect to login page
                        } else {
                            showGlobalSpinner(false);
                        }
                    } catch (error) {
                        logger.error("Logout failed unexpectedly:", error);
                        showToast('danger', 'Logout failed unexpectedly. Please try again.');
                        showGlobalSpinner(false);
                    }
                }
            });
        });
    }

    const exportHTMLButton = document.getElementById('exportVouchersHTMLButton');
    if (exportHTMLButton) {
        exportHTMLButton.addEventListener('click', function() {
            if (!lastGeneratedBatchCredentials || lastGeneratedBatchCredentials.length === 0) {
                showToast('warning', 'No generated voucher data available to view.');
                return;
            }
            const hotspotLoginUrlValue = document.getElementById('hotspotLoginUrl').value;
            if (!hotspotLoginUrlValue) {
                showToast('warning', 'Hotspot Login URL is not set in Settings (under the Settings Tab). QR Codes cannot be generated for viewing if this is missing.');
            }
            // Create a form to POST data to the new tab/window
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = `${API_BASE_URL}/api/vouchers/view_batch_html`;
            form.target = '_blank'; // Open in a new tab

            const vouchersInput = document.createElement('input');
            vouchersInput.type = 'hidden';
            vouchersInput.name = 'vouchers_json';
            vouchersInput.value = JSON.stringify(lastGeneratedBatchCredentials);
            form.appendChild(vouchersInput);

            const loginUrlInput = document.createElement('input');
            loginUrlInput.type = 'hidden';
            loginUrlInput.name = 'hotspot_login_url';
            loginUrlInput.value = hotspotLoginUrlValue; // Send even if empty, backend can decide
            form.appendChild(loginUrlInput);

            document.body.appendChild(form);
            form.submit();
            document.body.removeChild(form);
        });
    }

    const exportPDFButton = document.getElementById('exportVouchersPDFButton');
    if (exportPDFButton && !exportPDFButton.hasAttribute('data-listener-attached')) { // Check if listener already attached
        exportPDFButton.addEventListener('click', function() {
            if (!lastGeneratedBatchCredentials || lastGeneratedBatchCredentials.length === 0) {
                showToast('warning', 'No generated voucher data available for PDF export.');
                return;
            }
            const hotspotLoginUrlValue = document.getElementById('hotspotLoginUrl').value;
            if (!hotspotLoginUrlValue) {
                showToast('info', 'Hotspot Login URL is not set in Settings. QR Codes might be omitted in the PDF if this URL is required by the backend for them.');
            }
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = `${API_BASE_URL}/api/vouchers/download_batch_pdf`;

            const vouchersInput = document.createElement('input');
            vouchersInput.type = 'hidden';
            vouchersInput.name = 'vouchers_json';
            vouchersInput.value = JSON.stringify(lastGeneratedBatchCredentials);
            form.appendChild(vouchersInput);

            const loginUrlInput = document.createElement('input');
            loginUrlInput.type = 'hidden';
            loginUrlInput.name = 'hotspot_login_url';
            loginUrlInput.value = hotspotLoginUrlValue;
            form.appendChild(loginUrlInput);

            document.body.appendChild(form);
            form.submit();
            document.body.removeChild(form);
        });
        exportPDFButton.setAttribute('data-listener-attached', 'true'); // Mark as listener attached
    }

    const refreshAnalyticsBtn = document.getElementById('refreshAnalyticsButton');
    if (refreshAnalyticsBtn) {
        refreshAnalyticsBtn.addEventListener('click', loadAnalyticsData);
    }
});

async function init() {
    loadUsers();
    loadActiveSessions();
    loadProfiles(); // Load profiles for maintenance tab and filters
    // Analytics is loaded on first access via navigation listener
}

// --- User Management Functions ---
async function handleCreateUser(event) {
    event.preventDefault();
    const form = event.target;
    const userData = {
        username: form.username.value,
        password: form.password.value,
        profile: form.profile.value,
        'time-limit': form.timeLimit.value || undefined,
        'data-limit': form.dataLimit.value || undefined,
        comment: form.comment.value || undefined
    };

    try {
        const result = await apiCall('/api/users/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });
        if (result && result.success) {
            form.reset();
            loadUsers(); // Refresh user list
        }
    } catch (error) {
        logger.error("Error creating user:", error);
    }
}

async function handleBulkCreateUsers(event) {
    event.preventDefault();
    const form = event.target;
    const bulkData = {
        num_users: parseInt(form.bulkNumberOfUsers.value),
        profile: form.bulkProfile.value,
        time_limit: form.bulkTimeLimit.value || undefined,
        data_limit: form.bulkDataLimit.value || undefined,
        comment_prefix: form.bulkCommentPrefix.value || undefined,
        username_prefix: form.bulkUsernamePrefix.value || undefined,
        username_length: parseInt(form.bulkUsernameLength.value),
        password_length: parseInt(form.bulkPasswordLength.value),
        username_charset: form.bulkUsernameCharset.value,
        password_charset: form.bulkPasswordCharset.value
    };

    try {
        const result = await apiCall('/api/users/bulk_add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bulkData)
        });
        if (result && result.success) {
            lastGeneratedBatchCredentials = result.generated_users || [];
            const credentialsText = lastGeneratedBatchCredentials.map(u => `Username: ${u.username}, Password: ${u.password}`).join('\n');
            document.getElementById('bulkCreateCredentials').value = credentialsText;
            document.getElementById('bulkCreateResultDisplay').style.display = 'block';
            document.getElementById('exportVouchersHTMLButton').style.display = 'inline-block';
            document.getElementById('exportVouchersPDFButton').style.display = 'inline-block';
            loadUsers(); // Refresh user list
        }
    } catch (error) {
        logger.error("Error generating bulk users:", error);
        document.getElementById('bulkCreateResultDisplay').style.display = 'none';
        document.getElementById('exportVouchersHTMLButton').style.display = 'none';
        document.getElementById('exportVouchersPDFButton').style.display = 'none';
    }
}

function openEditUserModal(user) {
    const modal = document.getElementById('userModal');
    document.getElementById('editUsernameDisplay').textContent = user.username;
    document.getElementById('editUsernameOrig').value = user.username;
    document.getElementById('editPassword').value = ''; // Always clear password for security
    document.getElementById('editTimeLimit').value = user['time-limit'] || '';
    document.getElementById('editDataLimit').value = user['data-limit'] || '';
    document.getElementById('editComment').value = user.comment || '';
    document.getElementById('editDisabled').checked = !user.active;

    // Populate profile dropdown for edit modal
    const editProfileSelect = document.getElementById('editProfile');
    editProfileSelect.innerHTML = '';
    currentProfiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = profile.name;
        option.textContent = profile.name;
        if (profile.name === user.profile) {
            option.selected = true;
        }
        editProfileSelect.appendChild(option);
    });

    openModal('userModal');
}

async function handleEditUser(event) {
    event.preventDefault();
    const form = event.target;
    const originalUsername = document.getElementById('editUsernameOrig').value;
    const userData = {
        username: originalUsername, // Use original username for identification
        password: form.editPassword.value || undefined, // Only send if changed
        profile: form.editProfile.value,
        'time-limit': form.editTimeLimit.value || undefined,
        'data-limit': form.editDataLimit.value || undefined,
        comment: form.editComment.value || undefined,
        disabled: form.editDisabled.checked // Send true if disabled, false if active
    };

    try {
        const result = await apiCall('/api/users/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });
        if (result && result.success) {
            closeModal('userModal');
            loadUsers(); // Refresh user list
        }
    } catch (error) {
        logger.error("Error editing user:", error);
    }
}

async function deleteUser(username) {
    showConfirmationModal('Are you sure you want to delete user "' + username + '"?', async (confirmed) => {
        if (confirmed) {
            try {
                const result = await apiCall('/api/users/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: username })
                });
                if (result && result.success) {
                    loadUsers(); // Refresh user list
                }
            } catch (error) {
                logger.error("Error deleting user:", error);
            }
        }
    });
}

async function disconnectUser(username) {
    showConfirmationModal('Are you sure you want to disconnect user "' + username + '"?', async (confirmed) => {
        if (confirmed) {
            try {
                const result = await apiCall('/api/sessions/disconnect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: username })
                });
                if (result && result.success) {
                    loadActiveSessions(); // Refresh active sessions
                }
            } catch (error) {
                logger.error("Error disconnecting user:", error);
            }
        }
    });
}

async function deleteExpiredUsers() {
    showConfirmationModal('Are you sure you want to delete all expired users? This action cannot be undone.', async (confirmed) => {
        if (confirmed) {
            try {
                const result = await apiCall('/api/maintenance/delete_expired_users', {
                    method: 'POST'
                });
                if (result && result.success) {
                    loadUsers(); // Refresh user list after deletion
                }
            } catch (error) {
                logger.error("Error deleting expired users:", error);
            }
        }
    });
}

async function handleDeleteUsersByProfile() {
    const profileName = document.getElementById('deleteByProfileSelect').value;
    if (!profileName) {
        showToast('warning', 'Please select a profile to delete users from.');
        return;
    }

    showConfirmationModal('Are you sure you want to delete all users from profile "' + profileName + '"? This action cannot be undone.', async (confirmed) => {
        if (confirmed) {
            try {
                const result = await apiCall('/api/maintenance/delete_users_by_profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profile: profileName })
                });
                if (result && result.success) {
                    loadUsers(); // Refresh user list
                }
            } catch (error) {
                logger.error(`Error deleting users from profile ${profileName}:`, error);
            }
        }
    });
}

async function handleDeleteUsersByStatus() {
    const status = document.getElementById('deleteByStatusSelect').value;
    if (!status) {
        showToast('warning', 'Please select a status (Active or Disabled) to delete users.');
        return;
    }
    const statusText = status === 'active' ? 'active' : 'disabled';

    showConfirmationModal('Are you sure you want to delete all ' + statusText + ' users? This action cannot be undone.', async (confirmed) => {
        if (confirmed) {
            try {
                const result = await apiCall('/api/maintenance/delete_users_by_status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: status })
                });
                if (result && result.success) {
                    loadUsers(); // Refresh user list
                }
            } catch (error) {
                logger.error(`Error deleting ${status} users:`, error);
            }
        }
    });
}


// --- Profile Management Functions ---
function openProfileModal(profile = null) {
    const modal = document.getElementById('profileModal');
    const form = document.getElementById('profileForm');
    form.reset(); // Clear previous data

    document.getElementById('profileModalTitle').textContent = profile ? 'Edit Profile: ' + profile.name : 'Add New Profile';
    document.getElementById('profileId').value = profile ? profile.name : ''; // Hidden field to store original name for edit

    if (profile) {
        document.getElementById('profileName').value = profile.name;
        document.getElementById('profileRateLimit').value = profile['rate-limit'] || '';
        document.getElementById('profileSessionTimeout').value = profile['session-timeout'] || '';
        document.getElementById('profileSharedUsers').value = profile['shared-users'] || '';
        document.getElementById('profileName').readOnly = true; // Prevent editing name for existing profile
    } else {
        document.getElementById('profileName').readOnly = false; // Allow editing for new profile
    }

    openModal('profileModal');
}

async function handleProfileSave(event) {
    event.preventDefault();
    const form = event.target;
    const profileId = document.getElementById('profileId').value; // Existing profile name if editing
    const profileName = document.getElementById('profileName').value; // New or existing name

    const profileData = {
        name: profileName,
        'rate-limit': form.profileRateLimit.value || undefined,
        'session-timeout': form.profileSessionTimeout.value || undefined,
        'shared-users': form.profileSharedUsers.value || undefined
    };

    let endpoint = '/api/profiles/add';
    let method = 'POST';
    if (profileId) { // If profileId exists, it's an edit operation
        endpoint = '/api/profiles/edit';
        profileData.original_name = profileId; // Send original name for identification
    }

    try {
        const result = await apiCall(endpoint, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileData)
        });
        if (result && result.success) {
            closeModal('profileModal');
            loadProfiles(); // Refresh profile list
            loadUsers(); // Refresh users as profiles might change
        }
    } catch (error) {
        logger.error("Error saving profile:", error);
    }
}

async function deleteProfile(profileName) {
    showConfirmationModal('Are you sure you want to delete profile "' + profileName + '"? This will also delete any users associated with this profile. This action cannot be undone.', async (confirmed) => {
        if (confirmed) {
            try {
                const result = await apiCall('/api/profiles/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: profileName })
                });
                if (result && result.success) {
                    loadProfiles(); // Refresh profile list
                    loadUsers(); // Refresh users as profiles might change
                }
            } catch (error) {
                logger.error("Error deleting profile:", error);
            }
        }
    });
}


// --- Settings Functions ---
async function handleConfigSave(event) {
    event.preventDefault();
    const form = event.target;
    const configData = {
        router_host: form.routerHost.value,
        router_port: parseInt(form.routerPort.value),
        router_username: form.routerUsername.value,
        router_password: form.routerPassword.value || undefined, // Only send if user enters something
        hotspot_login_url: form.hotspotLoginUrl.value || undefined
    };

    try {
        const result = await apiCall('/api/config/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(configData)
        });
        if (result && result.success) {
            // Configuration saved, no need to refresh entire page
        }
    } catch (error) {
        logger.error("Error saving configuration:", error);
    }
}

async function testConnection() {
    showGlobalSpinner(true);
    try {
        const configData = { // Get current form values for testing
            router_host: document.getElementById('routerHost').value,
            router_port: parseInt(document.getElementById('routerPort').value),
            router_username: document.getElementById('routerUsername').value,
            router_password: document.getElementById('routerPassword').value // Don't use value from input if it's empty, use existing if any
        };

        const result = await apiCall('/api/config/test_connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(configData)
        });
        if (result && result.success) {
            showToast('success', 'Connection successful!');
        } else {
            showToast('danger', 'Connection failed: ' + (result.message || 'Unknown error.'));
        }
    } catch (error) {
        logger.error("Error testing connection:", error);
        showToast('danger', 'Failed to connect to the router. Please check your settings.');
    } finally {
        showGlobalSpinner(false);
    }
}


function triggerExport(exportType) {
    const profileFilter = document.getElementById('exportProfileFilter').value;
    const url = `${API_BASE_URL}/api/users/export?type=${exportType}${profileFilter ? `&profile=${encodeURIComponent(profileFilter)}` : ''}`;
    
    // For HTML and PDF vouchers, we need the hotspot login URL to generate QR codes.
    // If it's missing, warn the user.
    if (exportType === 'html_voucher' || exportType === 'pdf_voucher') {
        const hotspotLoginUrlValue = document.getElementById('hotspotLoginUrl').value;
        if (!hotspotLoginUrlValue) {
             showToast('warning', 'Hotspot Login URL is not set in Settings (under the Settings Tab). QR Codes might be omitted from vouchers if this URL is required by the backend for them.');
             // Allow to proceed if user wants to export without QR, backend will handle missing URL for QR.
        }
    }
    
    window.open(url, '_blank'); // Open in new tab for download/view
    showToast('info', 'Export initiated. Your download should begin shortly or open in a new tab.');
}