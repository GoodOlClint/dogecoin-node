class DogecoinMonitor {
    constructor() {
        console.log('Initializing Dogecoin Monitor...');
        
        // Configuration
        this.config = {
            refreshInterval: 10000, // 10 seconds
            maxDataPoints: 50,
            reconnectDelay: 5000 // 5 seconds
        };
        
        // Initialize state
        this.ws = null;
        this.charts = {};
        this.data = {
            blockHeight: [],
            mempoolSize: []
        };
        
        // Watchdog state
        this.watchdog = {
            isMonitoring: false,
            alerts: [],
            status: 'UNKNOWN'
        };
        
        // Update UI to show initialization
        this.updateConnectionStatus('connecting', 'Initializing...');
        
        // Start initialization sequence
        this.initialize();
    }
    
    async initialize() {
        try {
            console.log('Setting up charts...');
            this.initializeCharts();
            
            console.log('Loading initial data...');
            await this.loadInitialData();
            
            console.log('Connecting WebSocket...');
            this.connectWebSocket();
            
            // Set up fallback refresh timer
            setInterval(() => this.loadInitialData(), this.config.refreshInterval);
            
            console.log('Dogecoin Monitor fully initialized');
        } catch (error) {
            console.error('Failed to initialize:', error);
            this.updateConnectionStatus('error', 'Initialization Failed');
        }
    }
    
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        console.log('Attempting WebSocket connection to:', wsUrl);
        
        // Update status to show we're attempting connection
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            statusElement.textContent = 'Connecting...';
            statusElement.className = 'status connecting';
        }
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected successfully');
            this.updateConnectionStatus('connected');
        };
        
        this.ws.onmessage = (event) => {
            console.log('WebSocket message received:', event.data);
            const message = JSON.parse(event.data);
            if (message.type === 'update') {
                this.updateUI(message.data);
                
                // Handle watchdog data if present
                if (message.data.watchdog) {
                    this.updateWatchdogUI(message.data.watchdog);
                }
                
                this.updateLastUpdate();
            }
        };
        
        this.ws.onclose = (event) => {
            console.log('WebSocket disconnected. Code:', event.code, 'Reason:', event.reason);
            this.updateConnectionStatus('disconnected');
            // Attempt to reconnect after delay
            setTimeout(() => this.connectWebSocket(), 5000);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error occurred:', error);
            const statusElement = document.getElementById('connection-status');
            if (statusElement) {
                statusElement.textContent = 'Connection Failed';
                statusElement.className = 'status disconnected';
            }
        };
    }
    
    updateConnectionStatus(status, message = null) {
        const statusElement = document.getElementById('connection-status');
        if (!statusElement) return;
        
        // Handle boolean parameters for backward compatibility
        if (typeof status === 'boolean') {
            status = status ? 'connected' : 'disconnected';
        }
        
        const statusMap = {
            'connected': { text: 'Connected', class: 'status connected' },
            'connecting': { text: message || 'Connecting...', class: 'status connecting' },
            'disconnected': { text: 'Disconnected', class: 'status disconnected' },
            'error': { text: message || 'Connection Failed', class: 'status disconnected' }
        };
        
        const statusInfo = statusMap[status] || statusMap['error'];
        statusElement.textContent = statusInfo.text;
        statusElement.className = statusInfo.class;
        
        // Update page title to reflect connection status
        const titlePrefix = status === 'connected' ? '● ' : '○ ';
        document.title = `${titlePrefix}Dogecoin Monitor`;
    }
    
    updateLastUpdate() {
        const now = new Date();
        document.getElementById('last-update').textContent = 
            `Last update: ${now.toLocaleTimeString()}`;
    }
    
    async loadInitialData() {
        try {
            console.log('Loading initial data via REST API...');
            
            // Load basic info
            console.log('Fetching /api/info...');
            const infoResponse = await fetch('/api/info');
            if (!infoResponse.ok) {
                throw new Error(`Info API failed: ${infoResponse.status} ${infoResponse.statusText}`);
            }
            const info = await infoResponse.json();
            console.log('Info data received:', info);
            this.updateUI(info);
            
            // Load blocks
            console.log('Fetching /api/blocks/10...');
            const blocksResponse = await fetch('/api/blocks/10');
            if (!blocksResponse.ok) {
                throw new Error(`Blocks API failed: ${blocksResponse.status} ${blocksResponse.statusText}`);
            }
            const blocks = await blocksResponse.json();
            console.log('Blocks data received:', blocks.length, 'blocks');
            this.updateBlocksTable(blocks);
            
            // Load peers
            console.log('Fetching /api/peers...');
            const peersResponse = await fetch('/api/peers');
            if (!peersResponse.ok) {
                throw new Error(`Peers API failed: ${peersResponse.status} ${peersResponse.statusText}`);
            }
            const peers = await peersResponse.json();
            console.log('Peers data received:', peers.length, 'peers');
            this.updatePeersTable(peers);
            
            // Load watchdog data
            console.log('Fetching watchdog data...');
            await this.refreshWatchdogData();
            
            // If WebSocket is not connected, show that we're getting data via REST API
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                const statusElement = document.getElementById('connection-status');
                if (statusElement && statusElement.textContent !== 'Connected') {
                    statusElement.textContent = 'REST API';
                    statusElement.className = 'status connecting';
                }
            }
            
            this.updateLastUpdate();
            console.log('Initial data loaded successfully');
            
        } catch (error) {
            console.error('Error loading initial data:', error);
            console.error('Error stack:', error.stack);
            const statusElement = document.getElementById('connection-status');
            if (statusElement) {
                statusElement.textContent = 'Connection Failed';
                statusElement.className = 'status disconnected';
            }
        }
    }
    
    updateUI(data) {
        try {
            if (data.blockchain) {
                document.getElementById('block-height').textContent = 
                    data.blockchain.blocks.toLocaleString();
                document.getElementById('difficulty').textContent = 
                    this.formatNumber(data.blockchain.difficulty);
                document.getElementById('chain').textContent = data.blockchain.chain;
                document.getElementById('size-on-disk').textContent = 
                    this.formatBytes(data.blockchain.size_on_disk);
                
                // Update sync progress
                const syncProgress = ((data.blockchain.blocks / data.blockchain.headers) * 100).toFixed(2);
                document.getElementById('sync-progress').textContent = `${syncProgress}%`;
                
                // Add data point for chart
                this.addDataPoint('blockHeight', data.blockchain.blocks);
            }
            
            if (data.network) {
                document.getElementById('connections').textContent = data.network.connections;
                document.getElementById('node-version').textContent = data.network.subversion;
                document.getElementById('protocol-version').textContent = data.network.protocolversion;
            }
            
            if (data.mempool) {
                document.getElementById('mempool-size').textContent = 
                    data.mempool.size.toLocaleString();
                
                // Add data point for chart
                this.addDataPoint('mempoolSize', data.mempool.size);
            }
            
            this.updateCharts();
        } catch (error) {
            console.error('Error updating UI:', error);
            throw error; // Re-throw so the calling function can handle it
        }
    }
    
    addDataPoint(series, value) {
        if (!this.data[series]) {
            this.data[series] = [];
        }
        
        this.data[series].push({
            x: new Date(),
            y: value
        });
        
        // Keep only last N data points
        if (this.data[series].length > this.config.maxDataPoints) {
            this.data[series].shift();
        }
    }
    
    initializeCharts() {
        // Block Height Chart
        const blockHeightCtx = document.getElementById('blockHeightChart').getContext('2d');
        this.charts.blockHeight = new Chart(blockHeightCtx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Block Height',
                    data: [],
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            displayFormats: {
                                minute: 'HH:mm',
                                hour: 'HH:mm'
                            }
                        }
                    },
                    y: {
                        beginAtZero: false
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
        
        // Mempool Chart
        const mempoolCtx = document.getElementById('mempoolChart').getContext('2d');
        this.charts.mempool = new Chart(mempoolCtx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Mempool Size',
                    data: [],
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            displayFormats: {
                                minute: 'HH:mm',
                                hour: 'HH:mm'
                            }
                        }
                    },
                    y: {
                        beginAtZero: true
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }
    
    updateCharts() {
        if (this.charts.blockHeight && this.data.blockHeight.length > 0) {
            this.charts.blockHeight.data.datasets[0].data = this.data.blockHeight;
            this.charts.blockHeight.update('none');
        }
        
        if (this.charts.mempool && this.data.mempoolSize.length > 0) {
            this.charts.mempool.data.datasets[0].data = this.data.mempoolSize;
            this.charts.mempool.update('none');
        }
    }
    
    updateBlocksTable(blocks) {
        const tbody = document.getElementById('blocks-tbody');
        tbody.innerHTML = '';
        
        if (!blocks || blocks.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="loading">No blocks available</td></tr>';
            return;
        }
        
        blocks.forEach(block => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${block.height.toLocaleString()}</td>
                <td><span style="font-family: monospace; font-size: 0.8rem;">${block.hash.substring(0, 16)}...</span></td>
                <td>${new Date(block.time * 1000).toLocaleString()}</td>
                <td>${block.tx ? block.tx.length.toLocaleString() : 'N/A'}</td>
                <td>${this.formatBytes(block.size)}</td>
            `;
            tbody.appendChild(row);
        });
    }
    
    updatePeersTable(peers) {
        const tbody = document.getElementById('peers-tbody');
        tbody.innerHTML = '';
        
        if (!peers || peers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="loading">No peers connected</td></tr>';
            return;
        }
        
        peers.forEach(peer => {
            const row = document.createElement('tr');
            const connectionTime = new Date(peer.conntime * 1000).toLocaleString();
            
            row.innerHTML = `
                <td>${peer.addr}</td>
                <td>${peer.subver || 'Unknown'}</td>
                <td>${connectionTime}</td>
                <td>${this.formatBytes(peer.bytessent)}</td>
                <td>${this.formatBytes(peer.bytesrecv)}</td>
            `;
            tbody.appendChild(row);
        });
    }
    
    // Watchdog-related methods
    updateWatchdogUI(watchdogData) {
        try {
            console.log('Updating watchdog UI:', watchdogData);
            
            // Update watchdog state
            this.watchdog = {
                ...this.watchdog,
                ...watchdogData
            };
            
            // Update security status card
            this.updateSecurityStatusCard(watchdogData);
            
            // Update security alerts banner
            this.updateSecurityBanner(watchdogData);
            
            // Update security monitoring section
            this.updateSecuritySection(watchdogData);
            
        } catch (error) {
            console.error('Error updating watchdog UI:', error);
        }
    }
    
    updateSecurityStatusCard(watchdogData) {
        const statusElement = document.getElementById('watchdog-status');
        const detailsElement = document.getElementById('watchdog-details');
        const cardElement = document.getElementById('watchdog-card');
        
        if (!statusElement || !detailsElement || !cardElement) return;
        
        // Remove existing alert classes
        cardElement.classList.remove('alert', 'warning', 'normal');
        
        if (watchdogData.status === 'CRITICAL_ALERT') {
            statusElement.textContent = 'ALERT';
            statusElement.style.color = '#e74c3c';
            detailsElement.textContent = `${watchdogData.alertCount} Critical Alerts`;
            cardElement.classList.add('alert');
        } else if (watchdogData.alertCount > 0) {
            statusElement.textContent = 'Warning';
            statusElement.style.color = '#f39c12';
            detailsElement.textContent = `${watchdogData.alertCount} Active Alerts`;
            cardElement.classList.add('warning');
        } else {
            statusElement.textContent = 'Secure';
            statusElement.style.color = '#27ae60';
            detailsElement.textContent = 'No Threats Detected';
            cardElement.classList.add('normal');
        }
    }
    
    updateSecurityBanner(watchdogData) {
        const bannerSection = document.getElementById('security-alerts');
        const alertSummary = document.getElementById('alert-summary');
        
        if (!bannerSection || !alertSummary) return;
        
        if (watchdogData.status === 'CRITICAL_ALERT' && watchdogData.recentAlerts.length > 0) {
            const criticalAlert = watchdogData.recentAlerts.find(alert => alert.severity === 'CRITICAL');
            if (criticalAlert) {
                alertSummary.textContent = criticalAlert.message;
                bannerSection.style.display = 'block';
            }
        } else {
            bannerSection.style.display = 'none';
        }
    }
    
    updateSecuritySection(watchdogData) {
        // Update monitoring status badge
        const statusBadge = document.getElementById('watchdog-monitoring-status');
        if (statusBadge) {
            if (watchdogData.isMonitoring) {
                statusBadge.textContent = 'Monitoring';
                statusBadge.className = 'status-badge monitoring';
            } else {
                statusBadge.textContent = 'Stopped';
                statusBadge.className = 'status-badge stopped';
            }
        }
        
        // Update alert count
        const alertCount = document.getElementById('alert-count');
        if (alertCount) {
            const count = watchdogData.alertCount || 0;
            alertCount.textContent = count === 0 ? 'No alerts' : 
                                    count === 1 ? '1 alert' : `${count} alerts`;
        }
        
        // Update alerts list
        this.updateAlertsList(watchdogData.recentAlerts || []);
    }
    
    updateAlertsList(alerts) {
        const noAlertsDiv = document.getElementById('no-alerts');
        const alertsList = document.getElementById('alerts-list');
        
        if (!noAlertsDiv || !alertsList) return;
        
        if (alerts.length === 0) {
            noAlertsDiv.style.display = 'block';
            alertsList.style.display = 'none';
        } else {
            noAlertsDiv.style.display = 'none';
            alertsList.style.display = 'block';
            
            alertsList.innerHTML = alerts.map(alert => this.createAlertHTML(alert)).join('');
        }
    }
    
    createAlertHTML(alert) {
        const timeAgo = this.timeAgo(new Date(alert.timestamp));
        const severityClass = alert.severity.toLowerCase();
        
        return `
            <div class="alert-item ${severityClass}" data-alert-id="${alert.id}">
                <div class="alert-header">
                    <span class="alert-type">${alert.type.replace(/_/g, ' ')}</span>
                    <span class="alert-time">${timeAgo}</span>
                </div>
                <div class="alert-message">${alert.message}</div>
                <div class="alert-actions">
                    ${!alert.acknowledged ? 
                        `<button class="acknowledge-btn" onclick="window.dogecoinMonitor.acknowledgeAlert('${alert.id}')">
                            Acknowledge
                        </button>` : 
                        '<span class="acknowledged">✓ Acknowledged</span>'
                    }
                    <button class="details-btn" onclick="window.dogecoinMonitor.showAlertDetails('${alert.id}')">
                        Details
                    </button>
                </div>
            </div>
        `;
    }
    
    async acknowledgeAlert(alertId) {
        try {
            const response = await fetch(`/api/watchdog/alerts/${alertId}/acknowledge`, {
                method: 'POST'
            });
            
            if (response.ok) {
                console.log('Alert acknowledged successfully');
                // Refresh alerts
                await this.refreshWatchdogData();
            } else {
                console.error('Failed to acknowledge alert');
            }
        } catch (error) {
            console.error('Error acknowledging alert:', error);
        }
    }
    
    showAlertDetails(alertId) {
        // Look for the alert in recentAlerts first, then in alerts
        let alert = null;
        
        if (this.watchdog.recentAlerts) {
            alert = this.watchdog.recentAlerts.find(a => a.id === alertId);
        }
        
        if (!alert && this.watchdog.alerts) {
            alert = this.watchdog.alerts.find(a => a.id === alertId);
        }
        
        if (alert) {
            // Create a more user-friendly modal instead of alert()
            this.showAlertModal(alert);
        } else {
            console.error('Alert not found:', alertId);
            alert('Alert details not available');
        }
    }
    
    showAlertModal(alert) {
        // Create modal HTML
        const modalHTML = `
            <div class="alert-modal-overlay" onclick="this.remove()">
                <div class="alert-modal" onclick="event.stopPropagation()">
                    <div class="alert-modal-header">
                        <h3><i class="fas fa-exclamation-triangle"></i> Security Alert Details</h3>
                        <button class="alert-modal-close" onclick="this.closest('.alert-modal-overlay').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="alert-modal-body">
                        <div class="alert-detail-row">
                            <strong>Type:</strong> ${alert.type}
                        </div>
                        <div class="alert-detail-row">
                            <strong>Severity:</strong> 
                            <span class="severity-badge severity-${alert.severity.toLowerCase()}">${alert.severity}</span>
                        </div>
                        <div class="alert-detail-row">
                            <strong>Time:</strong> ${new Date(alert.timestamp).toLocaleString()}
                        </div>
                        <div class="alert-detail-row">
                            <strong>Message:</strong> ${alert.message}
                        </div>
                        ${alert.data ? `
                        <div class="alert-detail-row">
                            <strong>Technical Details:</strong>
                            <pre class="alert-data">${JSON.stringify(alert.data, null, 2)}</pre>
                        </div>
                        ` : ''}
                        ${alert.description ? `
                        <div class="alert-detail-row">
                            <strong>Description:</strong> ${alert.description}
                        </div>
                        ` : ''}
                    </div>
                    <div class="alert-modal-footer">
                        <button class="btn btn-secondary" onclick="this.closest('.alert-modal-overlay').remove()">
                            Close
                        </button>
                        ${!alert.acknowledged ? `
                        <button class="btn btn-primary" onclick="window.dogecoinMonitor.acknowledgeAlert('${alert.id}'); this.closest('.alert-modal-overlay').remove();">
                            Acknowledge Alert
                        </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }
    
    async refreshWatchdogData() {
        try {
            const response = await fetch('/api/watchdog/status');
            const result = await response.json();
            
            if (result.status === 'success') {
                this.updateWatchdogUI(result.data);
            }
        } catch (error) {
            console.error('Error refreshing watchdog data:', error);
        }
    }
    
    timeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${diffDays}d ago`;
    }
    
    // Utility methods
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    formatNumber(num) {
        if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return num.toLocaleString();
    }
}

// Global functions for UI interactions
function dismissSecurityBanner() {
    const banner = document.getElementById('security-alerts');
    if (banner) {
        banner.style.display = 'none';
    }
}

// Initialize the monitor when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing Dogecoin Monitor...');
    window.dogecoinMonitor = new DogecoinMonitor();
    console.log('Dogecoin Monitor initialized');
    
    // Set up watchdog control event listeners
    const refreshButton = document.getElementById('refresh-alerts');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            window.dogecoinMonitor.refreshWatchdogData();
        });
    }
    
    // Load initial watchdog data
    setTimeout(() => {
        window.dogecoinMonitor.refreshWatchdogData();
    }, 2000);
});
