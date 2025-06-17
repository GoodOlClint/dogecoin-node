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
            this.updateConnectionStatus(true);
        };
        
        this.ws.onmessage = (event) => {
            console.log('WebSocket message received:', event.data);
            const message = JSON.parse(event.data);
            if (message.type === 'update') {
                this.updateUI(message.data);
                this.updateLastUpdate();
            }
        };
        
        this.ws.onclose = (event) => {
            console.log('WebSocket disconnected. Code:', event.code, 'Reason:', event.reason);
            this.updateConnectionStatus(false);
            // Reconnect after 5 seconds
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
            const infoResponse = await fetch('/api/info');
            const info = await infoResponse.json();
            this.updateUI(info);
            
            // Load blocks
            const blocksResponse = await fetch('/api/blocks/10');
            const blocks = await blocksResponse.json();
            this.updateBlocksTable(blocks);
            
            // Load peers
            const peersResponse = await fetch('/api/peers');
            const peers = await peersResponse.json();
            this.updatePeersTable(peers);
            
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
            const statusElement = document.getElementById('connection-status');
            if (statusElement) {
                statusElement.textContent = 'Connection Failed';
                statusElement.className = 'status disconnected';
            }
        }
    }
    
    updateUI(data) {
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
        if (this.data[series].length > this.maxDataPoints) {
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

// Initialize the monitor when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing Dogecoin Monitor...');
    window.dogecoinMonitor = new DogecoinMonitor();
    console.log('Dogecoin Monitor initialized');
});
