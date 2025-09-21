"use client";
import { useEffect, useState } from "react";
import { ethers } from "ethers";

// Backend API Configuration - Try multiple possible ports
const POSSIBLE_BACKEND_URLS = [
  "http://localhost:5000",
  "http://localhost:3001", 
  "http://127.0.0.1:5000"
];

// Auto-detect working backend URL
let API_BASE_URL = "http://localhost:5000/api";
let HEALTH_URL = "http://localhost:5000/health";

// Helper function to resolve IPFS URLs
function resolveIPFS(uri) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return uri.replace("ipfs://", "https://ipfs.io/ipfs/");
  }
  return uri;
}

// Helper function to fetch IPFS metadata
async function fetchIPFSMetadata(tokenURI) {
  try {
    if (!tokenURI) return null;
    
    const resolvedURL = resolveIPFS(tokenURI);
    console.log('Fetching metadata from:', resolvedURL);
    
    const response = await fetch(resolvedURL);
    if (!response.ok) {
      throw new Error(`Failed to fetch metadata: ${response.status}`);
    }
    
    const metadata = await response.json();
    console.log('Fetched metadata:', metadata);
    return metadata;
  } catch (error) {
    console.error('Error fetching IPFS metadata:', error);
    return null;
  }
}

// API Service functions
const apiService = {
  // Auto-detect working backend URL
  async findWorkingBackend() {
    for (const baseUrl of POSSIBLE_BACKEND_URLS) {
      try {
        const response = await fetch(`${baseUrl}/health`, { 
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          }
        });
        if (response.ok) {
          API_BASE_URL = `${baseUrl}/api`;
          HEALTH_URL = `${baseUrl}/health`;
          return await response.json();
        }
      } catch (error) {
        console.log(`Backend not available at ${baseUrl}:`, error.message);
        continue;
      }
    }
    throw new Error('No backend server found. Please start your backend server.');
  },

  // Get all certificates for a wallet with metadata
  async getCertificates(walletAddress) {
    try {
      const response = await fetch(`${API_BASE_URL}/certificates/wallet/${walletAddress}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch certificates: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.certificates) {
        // Fetch metadata for each certificate
        const certificatesWithMetadata = await Promise.all(
          data.certificates.map(async (cert) => {
            try {
              const metadata = await fetchIPFSMetadata(cert.tokenURI);
              return {
                ...cert,
                metadata: metadata,
                // Merge metadata fields at top level for easier access
                ...metadata
              };
            } catch (error) {
              console.error(`Failed to fetch metadata for token ${cert.tokenId}:`, error);
              return cert; // Return original cert if metadata fails
            }
          })
        );
        
        return {
          ...data,
          certificates: certificatesWithMetadata
        };
      }
      
      return data;
    } catch (error) {
      console.error('Certificate fetch error:', error);
      throw error;
    }
  },

  // Get XDC balance for a wallet
  async getBalance(walletAddress) {
    try {
      const response = await fetch(`${API_BASE_URL}/wallet/${walletAddress}/balance`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch balance: ${response.status} ${response.statusText}`);
      }
      return response.json();
    } catch (error) {
      console.error('Balance fetch error:', error);
      throw error;
    }
  },

  // Verify a certificate by token ID
  async verifyCertificate(tokenId) {
    const response = await fetch(`${API_BASE_URL}/verify/${tokenId}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to verify certificate: ${response.statusText}`);
    }
    return response.json();
  },

  // Check backend health
  async checkHealth() {
    const response = await fetch(HEALTH_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      }
    });
    if (!response.ok) {
      throw new Error(`Backend health check failed: ${response.statusText}`);
    }
    return response.json();
  }
};

export default function ParticipantDashboard() {
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [certificateCount, setCertificateCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [metaMaskInstalled, setMetaMaskInstalled] = useState(true);
  const [isClient, setIsClient] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCertificate, setSelectedCertificate] = useState(null);
  const [backendStatus, setBackendStatus] = useState(null);
  const [metadataLoading, setMetadataLoading] = useState(false);

  useEffect(() => {
    setIsClient(true);
    checkBackendHealth();
  }, []);

  useEffect(() => {
    if (!isClient) return;
    if (!window.ethereum) {
      setMetaMaskInstalled(false);
      return;
    }

    const storedWallet = localStorage.getItem("walletAddress");
    if (!storedWallet) {
      setError("No wallet connected! Please connect your wallet first.");
      setLoading(false);
      return;
    }
    setWallet(storedWallet);
    fetchWalletData(storedWallet);
  }, [isClient]);

  const checkBackendHealth = async () => {
    try {
      const health = await apiService.findWorkingBackend();
      setBackendStatus(health);
      console.log('Backend found and working:', health);
    } catch (err) {
      console.error("No backend server found:", err.message);
      setBackendStatus({ status: "ERROR", message: err.message });
    }
  };

  const fetchWalletData = async (address) => {
    try {
      setLoading(true);
      setMetadataLoading(true);
      setError(null);

      // Ensure we're on the correct network
      await ensureCorrectNetwork();

      // Fetch certificates and balance in parallel
      const [certificatesResponse, balanceResponse] = await Promise.allSettled([
        apiService.getCertificates(address),
        apiService.getBalance(address)
      ]);

      // Handle certificates response
      if (certificatesResponse.status === 'fulfilled') {
        const certsData = certificatesResponse.value;
        if (certsData.success) {
          const certs = certsData.certificates || [];
          console.log('Certificates with metadata:', certs);
          setCertificates(certs);
          setCertificateCount(certsData.count || certs.length);
        } else {
          throw new Error(certsData.error || 'Failed to fetch certificates');
        }
      } else {
        console.error('Certificates fetch failed:', certificatesResponse.reason);
        setCertificates([]);
        setCertificateCount(0);
      }

      // Handle balance response
      if (balanceResponse.status === 'fulfilled') {
        const balanceData = balanceResponse.value;
        if (balanceData.success) {
          setBalance(balanceData.balance.formatted);
        } else {
          await fetchDirectBalance(address);
        }
      } else {
        console.error('Balance fetch failed:', balanceResponse.reason);
        await fetchDirectBalance(address);
      }

      setLoading(false);
      setMetadataLoading(false);
    } catch (err) {
      console.error("Error fetching wallet data:", err);
      setError(`Failed to load dashboard data: ${err.message}`);
      setLoading(false);
      setMetadataLoading(false);
    }
  };

  const ensureCorrectNetwork = async () => {
    if (!window.ethereum) return;

    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    const apothemChainId = "0x33"; // Apothem Testnet

    if (chainId !== apothemChainId) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: apothemChainId }],
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: apothemChainId,
                chainName: "XDC Apothem Network",
                nativeCurrency: { name: "XDC", symbol: "XDC", decimals: 18 },
                rpcUrls: ["https://erpc.apothem.network"],
                blockExplorerUrls: ["https://explorer.apothem.network/"],
              },
            ],
          });
        } else {
          throw switchError;
        }
      }
    }
  };

  const fetchDirectBalance = async (address) => {
    try {
      if (!window.ethereum) return;
      const provider = new ethers.BrowserProvider(window.ethereum);
      const bal = await provider.getBalance(address);
      setBalance(ethers.formatEther(bal));
    } catch (err) {
      console.error("Failed to fetch direct balance:", err);
      setBalance("Unable to load");
    }
  };

  const handleCertificateClick = (certificate) => {
    setSelectedCertificate(certificate);
  };

  const closeCertificateModal = () => {
    setSelectedCertificate(null);
  };

  const handleConnectWallet = () => {
    window.location.href = '/';
  };

  const refreshData = () => {
    if (wallet) {
      fetchWalletData(wallet);
    }
  };

  // Helper functions to extract certificate data
  const getCertificateImage = (cert) => {
    return cert.image || cert.metadata?.image || null;
  };

  const getCertificateName = (cert) => {
    return cert.name || cert.metadata?.name || `Certificate #${cert.tokenId}`;
  };

  const getCertificateDescription = (cert) => {
    return cert.description || cert.metadata?.description || '';
  };

  const getCertificateAttributes = (cert) => {
    return cert.attributes || cert.metadata?.attributes || [];
  };

  const getEventName = (cert) => {
    return cert.event_name || cert.metadata?.event_name || 
           getCertificateAttributes(cert).find(attr => attr.trait_type === 'Event')?.value || '';
  };

  const getRecipientName = (cert) => {
    return cert.recipient_name || cert.metadata?.recipient_name || 
           getCertificateAttributes(cert).find(attr => attr.trait_type === 'Recipient')?.value || '';
  };

  const getDateIssued = (cert) => {
    return cert.date_issued || cert.metadata?.date_issued || 
           getCertificateAttributes(cert).find(attr => attr.trait_type === 'Date Issued')?.value || '';
  };

  const getCertificateLevel = (cert) => {
    return getCertificateAttributes(cert).find(attr => attr.trait_type === 'Level')?.value || '';
  };

  const getSkills = (cert) => {
    return getCertificateAttributes(cert)
      .filter(attr => attr.trait_type.startsWith('Skill'))
      .map(attr => attr.value);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  // Error states
  if (!metaMaskInstalled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white flex items-center justify-center">
        <div className="text-center p-8 bg-gray-800 rounded-2xl shadow-2xl">
          <div className="text-6xl mb-4">🦊</div>
          <h1 className="text-2xl font-bold mb-4">MetaMask Required</h1>
          <p className="text-gray-300 mb-6">Please install MetaMask to access your dashboard.</p>
          <a
            href="https://metamask.io/download/"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-orange-500 hover:bg-orange-600 px-6 py-3 rounded-lg font-semibold transition-colors"
          >
            Install MetaMask
          </a>
        </div>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white flex items-center justify-center">
        <div className="text-center p-8 bg-gray-800 rounded-2xl shadow-2xl">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold mb-4">{error ? 'Connection Error' : 'No Wallet Connected'}</h1>
          <p className="text-gray-300 mb-6">
            {error || 'Please connect your wallet to access your dashboard.'}
          </p>
          <button
            onClick={handleConnectWallet}
            className="bg-[#54D1DC] hover:bg-[#3fb8c4] px-6 py-3 rounded-lg font-semibold transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-black/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-[#54D1DC] to-blue-400 bg-clip-text text-transparent">
                Certificate Dashboard
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                Wallet: {wallet.slice(0, 6)}...{wallet.slice(-4)}
              </p>
            </div>
            
            <div className="flex items-center gap-6">
              {/* Backend Status */}
              {backendStatus && (
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    backendStatus.status === 'OK' ? 'bg-green-400' : 'bg-red-400'
                  }`}></div>
                  <span className="text-sm text-gray-400">
                    {backendStatus.status === 'OK' ? 'Backend Online' : 'Backend Offline'}
                  </span>
                </div>
              )}
              
              {/* Metadata Loading Indicator */}
              {metadataLoading && (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-[#54D1DC] border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-sm text-gray-400">Loading metadata...</span>
                </div>
              )}
              
              {/* Balance Display */}
              <div className="bg-gray-800 rounded-lg px-4 py-2">
                <div className="text-sm text-gray-400">XDC Balance</div>
                <div className="text-lg font-bold text-[#54D1DC]">
                  {balance ? `${parseFloat(balance).toFixed(4)} XDC` : "Loading..."}
                </div>
              </div>

              {/* Certificate Count */}
              <div className="bg-gray-800 rounded-lg px-4 py-2">
                <div className="text-sm text-gray-400">Certificates</div>
                <div className="text-lg font-bold text-green-400">
                  {certificateCount}
                </div>
              </div>

              {/* Refresh Button */}
              <button
                onClick={refreshData}
                disabled={loading}
                className="bg-gray-700 hover:bg-gray-600 p-2 rounded-lg transition-colors disabled:opacity-50"
                title="Refresh Data"
              >
                <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Error Display */}
        {error && (
          <div className="mb-8 bg-red-900/50 border border-red-500 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <div className="text-red-400">⚠️</div>
              <div>
                <div className="font-semibold text-red-300">Error</div>
                <div className="text-red-200">{error}</div>
              </div>
            </div>
          </div>
        )}

        {/* Certificates Section */}
        <section>
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold">Your Certificates</h2>
            {!loading && certificates.length > 0 && (
              <div className="text-gray-400">
                {certificates.length} certificate{certificates.length !== 1 ? 's' : ''} found
              </div>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-gray-800 rounded-xl p-6 animate-pulse">
                  <div className="bg-gray-700 h-48 rounded-lg mb-4"></div>
                  <div className="bg-gray-700 h-4 rounded mb-2"></div>
                  <div className="bg-gray-700 h-4 rounded w-3/4 mb-2"></div>
                  <div className="bg-gray-700 h-4 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : certificates.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">📜</div>
              <h3 className="text-xl font-semibold mb-2">No Certificates Found</h3>
              <p className="text-gray-400 mb-6">
                You don't have any certificates in this wallet yet.
              </p>
              <button
                onClick={refreshData}
                className="bg-[#54D1DC] hover:bg-[#3fb8c4] px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                Refresh
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {certificates.map((cert) => (
                <div
                  key={cert.tokenId}
                  onClick={() => handleCertificateClick(cert)}
                  className="bg-gray-800 rounded-xl shadow-lg p-6 hover:bg-gray-750 transition-all cursor-pointer transform hover:scale-105 border border-gray-700 hover:border-[#54D1DC]/50"
                >
                  <div className="relative mb-4">
                    <img
                      src={resolveIPFS(getCertificateImage(cert)) || "/placeholder-certificate.png"}
                      alt={getCertificateName(cert)}
                      className="w-full h-48 object-contain rounded-lg bg-gray-700"
                      onError={(e) => {
                        e.target.src = "/placeholder-certificate.png";
                      }}
                    />
                    <div className="absolute top-2 right-2 bg-[#54D1DC] text-black px-2 py-1 rounded text-xs font-bold">
                      #{cert.tokenId}
                    </div>
                    {getCertificateLevel(cert) && (
                      <div className="absolute top-2 left-2 bg-purple-600 text-white px-2 py-1 rounded text-xs font-bold">
                        {getCertificateLevel(cert)}
                      </div>
                    )}
                  </div>
                  
                  <h3 className="text-xl font-bold mb-2 text-white">
                    {getCertificateName(cert)}
                  </h3>

                  {/* Event Name */}
                  {getEventName(cert) && (
                    <div className="mb-2">
                      <span className="text-xs text-gray-400 uppercase tracking-wide">Event</span>
                      <p className="text-[#54D1DC] font-semibold text-sm">
                        {getEventName(cert)}
                      </p>
                    </div>
                  )}

                  {/* Recipient Name */}
                  {getRecipientName(cert) && (
                    <div className="mb-2">
                      <span className="text-xs text-gray-400 uppercase tracking-wide">Recipient</span>
                      <p className="text-white font-medium text-sm">
                        {getRecipientName(cert)}
                      </p>
                    </div>
                  )}

                  {/* Date Issued */}
                  {getDateIssued(cert) && (
                    <div className="mb-3">
                      <span className="text-xs text-gray-400 uppercase tracking-wide">Issued</span>
                      <p className="text-gray-300 text-sm">
                        {formatDate(getDateIssued(cert))}
                      </p>
                    </div>
                  )}

                  {/* Skills */}
                  {getSkills(cert).length > 0 && (
                    <div className="mb-3">
                      <span className="text-xs text-gray-400 uppercase tracking-wide block mb-1">Skills</span>
                      <div className="flex flex-wrap gap-1">
                        {getSkills(cert).slice(0, 3).map((skill, index) => (
                          <span key={index} className="bg-blue-600 text-white text-xs px-2 py-1 rounded">
                            {skill}
                          </span>
                        ))}
                        {getSkills(cert).length > 3 && (
                          <span className="bg-gray-700 text-xs px-2 py-1 rounded">
                            +{getSkills(cert).length - 3} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Description fallback if no specific fields */}
                  {!getEventName(cert) && !getRecipientName(cert) && getCertificateDescription(cert) && (
                    <p className="text-gray-400 mb-3 text-sm line-clamp-2">
                      {getCertificateDescription(cert)}
                    </p>
                  )}

                  <div className="flex justify-between items-center">
                    <span className="text-[#54D1DC] text-sm font-semibold">
                      Click to view details
                    </span>
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Enhanced Certificate Detail Modal */}
      {selectedCertificate && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-2xl font-bold text-white mb-2">
                    {getCertificateName(selectedCertificate)}
                  </h3>
                  {getEventName(selectedCertificate) && (
                    <p className="text-[#54D1DC] text-lg font-semibold">
                      {getEventName(selectedCertificate)}
                    </p>
                  )}
                </div>
                <button
                  onClick={closeCertificateModal}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Certificate Image */}
                <div>
                  <img
                    src={resolveIPFS(getCertificateImage(selectedCertificate)) || "/placeholder-certificate.png"}
                    alt={getCertificateName(selectedCertificate)}
                    className="w-full h-80 object-contain rounded-lg bg-gray-700"
                    onError={(e) => {
                      e.target.src = "/placeholder-certificate.png";
                    }}
                  />
                </div>

                {/* Certificate Details */}
                <div className="space-y-4">
                  {/* Recipient Information */}
                  {getRecipientName(selectedCertificate) && (
                    <div className="bg-gray-700 p-4 rounded-lg">
                      <h4 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">
                        Certificate Holder
                      </h4>
                      <p className="text-xl font-bold text-white">
                        {getRecipientName(selectedCertificate)}
                      </p>
                    </div>
                  )}

                  {/* Certificate Level and Date */}
                  <div className="grid grid-cols-2 gap-4">
                    {getCertificateLevel(selectedCertificate) && (
                      <div className="bg-purple-600/20 border border-purple-600 p-3 rounded-lg">
                        <div className="text-xs text-purple-300 uppercase tracking-wide">Level</div>
                        <p className="text-purple-100 font-bold">{getCertificateLevel(selectedCertificate)}</p>
                      </div>
                    )}
                    
                    {getDateIssued(selectedCertificate) && (
                      <div className="bg-blue-600/20 border border-blue-600 p-3 rounded-lg">
                        <div className="text-xs text-blue-300 uppercase tracking-wide">Date Issued</div>
                        <p className="text-blue-100 font-semibold">
                          {formatDate(getDateIssued(selectedCertificate))}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Skills Section */}
                  {getSkills(selectedCertificate).length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">
                        Skills Validated
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {getSkills(selectedCertificate).map((skill, index) => (
                          <span key={index} className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-medium">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Description */}
                  {getCertificateDescription(selectedCertificate) && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">
                        Description
                      </h4>
                      <p className="text-gray-200 leading-relaxed">
                        {getCertificateDescription(selectedCertificate)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Technical Details */}
              <div className="mt-6 pt-6 border-t border-gray-700">
                <h4 className="text-lg font-semibold text-white mb-4">Technical Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-400">Token ID</label>
                    <p className="text-white font-mono">#{selectedCertificate.tokenId}</p>
                  </div>

                  <div>
                    <label className="text-sm text-gray-400">Network</label>
                    <p className="text-white">XDC Apothem Testnet</p>
                  </div>

                  <div>
                    <label className="text-sm text-gray-400">Owner Address</label>
                    <p className="text-white font-mono text-sm break-all">{selectedCertificate.owner}</p>
                  </div>

                  <div>
                    <label className="text-sm text-gray-400">Contract Address</label>
                    <p className="text-white font-mono text-sm break-all">
                      {process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || 'Not configured'}
                    </p>
                  </div>
                </div>

                {selectedCertificate.tokenURI && (
                  <div className="mt-4">
                    <label className="text-sm text-gray-400">Metadata URI</label>
                    <div className="flex items-center gap-2">
                      <p className="text-white font-mono text-sm truncate">{selectedCertificate.tokenURI}</p>
                      <a 
                        href={resolveIPFS(selectedCertificate.tokenURI)} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-[#54D1DC] hover:text-[#3fb8c4] text-sm"
                      >
                        View IPFS ↗
                      </a>
                    </div>
                  </div>
                )}

                {/* All Attributes */}
                {getCertificateAttributes(selectedCertificate).length > 0 && (
                  <div className="mt-4">
                    <label className="text-sm text-gray-400 mb-2 block">All Attributes</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {getCertificateAttributes(selectedCertificate).map((attr, index) => (
                        <div key={index} className="bg-gray-700 p-2 rounded">
                          <div className="text-xs text-gray-400">{attr.trait_type}</div>
                          <div className="text-white text-sm">{attr.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Verification Status */}
                <div className="mt-4">
                  <label className="text-sm text-gray-400">Verification Status</label>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                    <p className="text-green-400 font-semibold">Verified on Blockchain</p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 pt-6 border-t border-gray-700">
                <div className="flex flex-col sm:flex-row gap-4">
                  <a
                    href={`https://apothem.xdcscan.com/address/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || 'CONTRACT_ADDRESS'}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 bg-[#54D1DC] hover:bg-[#3fb8c4] text-black px-4 py-3 rounded-lg font-semibold text-center transition-colors"
                  >
                    View Contract on XDCScan
                  </a>
                  
                  <a
                    href={`https://apothem.xdcscan.com/token/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || 'CONTRACT_ADDRESS'}/${selectedCertificate.tokenId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-semibold text-center transition-colors"
                  >
                    View Token Details
                  </a>
                  
                  <button
                    onClick={() => {
                      const shareText = `Check out my certificate: ${getCertificateName(selectedCertificate)}${getEventName(selectedCertificate) ? ` from ${getEventName(selectedCertificate)}` : ''} - Token ID: #${selectedCertificate.tokenId}`;
                      const shareUrl = `https://apothem.xdcscan.com/token/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || 'CONTRACT_ADDRESS'}/${selectedCertificate.tokenId}`;
                      
                      if (navigator.share) {
                        navigator.share({ 
                          title: 'My Certificate', 
                          text: shareText, 
                          url: shareUrl 
                        });
                      } else {
                        navigator.clipboard?.writeText(`${shareText}\n${shareUrl}`);
                        alert('Certificate details copied to clipboard!');
                      }
                    }}
                    className="flex-1 bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-lg font-semibold text-center transition-colors"
                  >
                    Share Certificate
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}