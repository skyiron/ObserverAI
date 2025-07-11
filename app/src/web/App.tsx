import { useState, useEffect, useCallback } from 'react';
import { Terminal, Server } from 'lucide-react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { 
  listAgents, 
  getAgentCode,
  deleteAgent,
  saveAgent,
  CompleteAgent,
} from '@utils/agent_database';
import { startAgentLoop, stopAgentLoop, AGENT_STATUS_CHANGED_EVENT } from '@utils/main_loop';
import { Logger } from '@utils/logging';
import { MEMORY_UPDATE_EVENT } from '@components/MemoryManager';

// Imported Components
import AppHeader from '@components/AppHeader';
import AgentCard from '@components/AgentCard';
import EditAgentModal from '@components/EditAgent/EditAgentModal';
import StartupDialogs from '@components/StartupDialogs';
import GlobalLogsViewer from '@components/GlobalLogsViewer';
import ScheduleAgentModal from '@components/ScheduleAgentModal';
import MemoryManager from '@components/MemoryManager';
import ErrorDisplay from '@components/ErrorDisplay';
import AgentImportHandler from '@components/AgentImportHandler';
import SidebarMenu from '@components/SidebarMenu';
import AvailableModels from '@components/AvailableModels';
import CommunityTab from '@components/CommunityTab';
import GetStarted from '@components/GetStarted';
import JupyterServerModal from '@components/JupyterServerModal';

function AppContent() {
  const { isAuthenticated, user, loginWithRedirect, logout, isLoading } = useAuth0();
  
  const [agents, setAgents] = useState<CompleteAgent[]>([]);
  const [agentCodes, setAgentCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<'unchecked' | 'online' | 'offline'>('unchecked');
  const [startingAgents, setStartingAgents] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [showStartupDialog, setShowStartupDialog] = useState(true);
  const [showGlobalLogs, setShowGlobalLogs] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [schedulingAgentId, setSchedulingAgentId] = useState<string | null>(null);
  const [isMemoryManagerOpen, setIsMemoryManagerOpen] = useState(false);
  const [memoryAgentId, setMemoryAgentId] = useState<string | null>(null);
  const [flashingMemories, setFlashingMemories] = useState<Set<string>>(new Set());
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('myAgents');
  const [isUsingObServer, setIsUsingObServer] = useState(false);
  const [isJupyterModalOpen, setIsJupyterModalOpen] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      setIsRefreshing(true);
      Logger.debug('APP', 'Fetching agents from database');
      const agentsData = await listAgents();
      setAgents(agentsData);
      Logger.debug('APP', `Found ${agentsData.length} agents`);

      // Fetch codes
      const codeResults = await Promise.all(
        agentsData.map(async (a) => ({ id: a.id, code: await getAgentCode(a.id) }))
      );
      const newCodes: Record<string, string> = {};
      codeResults.forEach((r) => {
        if (r.code) newCodes[r.id] = r.code;
      });
      setAgentCodes(newCodes);

      setError(null);
    } catch (err) {
      setError('Failed to fetch agents from database');
      Logger.error('APP', `Error fetching agents:`, err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const handleAgentStatusChange = (event: CustomEvent) => {
      const { agentId, status } = event.detail || {};
      Logger.info('APP', `agentStatusChanged:`, { agentId, status });
      fetchAgents();
    };

    window.addEventListener(
      AGENT_STATUS_CHANGED_EVENT,
      handleAgentStatusChange as EventListener
    );
    return () => {
      window.removeEventListener(
        AGENT_STATUS_CHANGED_EVENT,
        handleAgentStatusChange as EventListener
      );
    };
  }, [fetchAgents]);

  const handleEditClick = async (agentId: string) => {
    setSelectedAgent(agentId);
    setIsCreateMode(false);
    setIsEditModalOpen(true);
    Logger.info('APP', `Opening editor for agent ${agentId}`);
  };

  const handleAddAgentClick = () => {
    setSelectedAgent(null);
    setIsCreateMode(true);
    setIsEditModalOpen(true);
    Logger.info('APP', 'Creating new agent');
  };

  const handleMemoryClick = (agentId: string) => {
    if (flashingMemories.has(agentId)) {
      const newFlashing = new Set(flashingMemories);
      newFlashing.delete(agentId);
      setFlashingMemories(newFlashing);
    }
    
    setMemoryAgentId(agentId);
    setIsMemoryManagerOpen(true);
    Logger.info('APP', `Opening memory manager for agent ${agentId}`);
  };

  const handleDeleteClick = async (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;
    
    if (window.confirm(`Are you sure you want to delete agent "${agent.name}"?`)) {
      try {
        setError(null);
        Logger.info('APP', `Deleting agent "${agent.name}" (${agentId})`);
        
        if (agent.status === 'running') {
          Logger.info(agentId, `Stopping agent before deletion`);
          stopAgentLoop(agentId);
        }
        
        await deleteAgent(agentId);
        Logger.info('APP', `Agent "${agent.name}" deleted successfully`);
        await fetchAgents();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        Logger.error('APP', `Failed to delete agent: ${errorMessage}`, err);
      }
    }
  };

  const handleDismissStartupDialog = () => {
    setShowStartupDialog(false);
  };

  const toggleAgent = async (id: string, currentStatus: string): Promise<void> => {
    try {
      setError(null);
      const agent = agents.find(a => a.id === id);
      
      if (!agent) {
        throw new Error(`Agent ${id} not found`);
      }
      const isStartingUp = startingAgents.has(id);
      
      if (isStartingUp || currentStatus === 'running') {
        Logger.info(id, `Stopping agent "${agent.name}"`);
        stopAgentLoop(id);
        if (isStartingUp) {
          setStartingAgents(prev => {
            const updated = new Set(prev);
            updated.delete(id);
            return updated;
          });
        }
        //await updateAgentStatus(id, 'stopped'); // NOW HANDLED BY stopAgentLoop() internally 
        //Logger.debug(id, `Agent status updated to "stopped" in database`);
      } else {
        Logger.info(id, `Starting agent "${agent.name}"`);
        setStartingAgents(prev => {
          const updated = new Set(prev);
          updated.add(id);
          return updated;
        });
        
        try {
          await startAgentLoop(id);
          //await updateAgentStatus(id, 'running'); // NOW HANDLED BY startAgentLoop() internally
          //Logger.debug(id, `Agent status updated to "running" in database`);
        } finally {
          setStartingAgents(prev => {
            const updated = new Set(prev);
            updated.delete(id);
            return updated;
          });
        }
      }
      
      await fetchAgents();
    } catch (err) {
      setStartingAgents(prev => {
        const updated = new Set(prev);
        updated.delete(id);
        return updated;
      });
      
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      Logger.error('APP', `Failed to toggle agent status: ${errorMessage}`, err);
    }
  };

  const handleSaveAgent = async (agent: CompleteAgent, code: string) => {
    try {
      setError(null);
      const isNew = !agents.some(a => a.id === agent.id);
      
      Logger.info('APP', isNew 
        ? `Creating new agent "${agent.name}"` 
        : `Updating agent "${agent.name}" (${agent.id})`
      );
      
      await saveAgent(agent, code);
      Logger.info('APP', `Agent "${agent.name}" saved successfully`);
      await fetchAgents();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      Logger.error('APP', `Failed to save agent: ${errorMessage}`, err);
    }
  };

  useEffect(() => {
    const handleMemoryUpdate = (event: CustomEvent) => {
      const updatedAgentId = event.detail.agentId;
      
      if (updatedAgentId !== memoryAgentId || !isMemoryManagerOpen) {
        setFlashingMemories(prev => {
          const newSet = new Set(prev);
          newSet.add(updatedAgentId);
          return newSet;
        });
        
        Logger.debug('APP', `Memory updated for agent ${updatedAgentId}, setting flash indicator`);
      }
    };
    
    window.addEventListener(MEMORY_UPDATE_EVENT, handleMemoryUpdate as EventListener);
    
    return () => {
      window.removeEventListener(MEMORY_UPDATE_EVENT, handleMemoryUpdate as EventListener);
    };
  }, [memoryAgentId, isMemoryManagerOpen]);

  //useEffect(() => {
  //  // Handler function for the agent status changed event
  //  const handleAgentStatusChange = (event: CustomEvent) => {
  //    // We don't strictly need the details (agentId, status) from the event
  //    // because we're just going to refetch everything.
  //    // But logging them can be useful for debugging.
  //    const { agentId, status } = event.detail || {};
  //    Logger.info('APP', `Received ${AGENT_STATUS_CHANGED_EVENT} event`, { agentId, status });
  //
  //    // Call fetchAgents to refresh the entire agent list from the database
  //    fetchAgents();
  //  };
  //
  //  // Add the event listener
  //  window.addEventListener(AGENT_STATUS_CHANGED_EVENT, handleAgentStatusChange as EventListener);
  //  Logger.info('APP', `Added listener for ${AGENT_STATUS_CHANGED_EVENT}`);
  //
  //  // Clean up the event listener when the component unmounts
  //  return () => {
  //    window.removeEventListener(AGENT_STATUS_CHANGED_EVENT, handleAgentStatusChange as EventListener);
  //    Logger.debug('APP', `Removed listener for ${AGENT_STATUS_CHANGED_EVENT}`);
  //  };
  //
  //}, [fetchAgents]);


  
  useEffect(() => {
    Logger.info('APP', 'Application starting');
    fetchAgents();
    
    if (isAuthenticated) {
      Logger.info('AUTH', `User authenticated: ${user?.name || user?.email || 'Unknown user'}`);
    } else if (!isLoading) {
      Logger.info('AUTH', 'User not authenticated');
    }
    
    const handleWindowError = (event: ErrorEvent) => {
      Logger.error('APP', `Uncaught error: ${event.message}`, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error
      });
    };
    
    window.addEventListener('error', handleWindowError);
    
    return () => {
      window.removeEventListener('error', handleWindowError);
    };
  }, [isAuthenticated, isLoading, user]);
  
  useEffect(() => {
    if (!isLoading) {
      Logger.info('AUTH', `Auth loading complete, authenticated: ${isAuthenticated}`);
    }
  }, [isLoading, isAuthenticated]);

  useEffect(() => {
    if (serverStatus === 'offline') {
      setShowStartupDialog(true);
    }
  }, [serverStatus]);


  return (
    <div className="min-h-screen bg-gray-50">
      <style>
        {`
          @keyframes memory-flash {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
          .animate-pulse {
            animation: memory-flash 1.5s ease-in-out infinite;
          }
        `}
      </style>

        {showStartupDialog && (
          <StartupDialogs 
            serverStatus={serverStatus}
            onDismiss={handleDismissStartupDialog}
            setServerStatus={setServerStatus}
            setUseObServer={setIsUsingObServer} // Add this prop
            />
        )}

        <AppHeader 
          serverStatus={serverStatus}
          setServerStatus={setServerStatus}
          setError={setError}
          isUsingObServer={isUsingObServer} // Add this prop
          setIsUsingObServer={setIsUsingObServer} // Add this prop
          authState={{
            isLoading,
            isAuthenticated,
            user,
            loginWithRedirect,
            logout
          }}
          onMenuClick={() => setIsSidebarOpen(true)}
          shouldHighlightMenu={agents.length === 0}
        />


        {/* Sidebar Menu */}
        <SidebarMenu 
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            setIsSidebarOpen(false);
          }}
        />

        {/* Jupyter Server config */}
        <JupyterServerModal
          isOpen={isJupyterModalOpen}
          onClose={() => setIsJupyterModalOpen(false)}
        />

        {/* Main content, replace the TabNavigation and TabContent with this */}
        <main className="max-w-7xl mx-auto px-4 pt-24 pb-16">
          <AgentImportHandler 
            onAddAgent={handleAddAgentClick}
            agentCount={agents.length}
            activeAgentCount={agents.filter(a => a.status === 'running').length}
            isRefreshing={isRefreshing}
            onRefresh={fetchAgents}
          />

          {error && <ErrorDisplay message={error} />}

          {activeTab === 'myAgents' ? (
            <div className="flex flex-wrap gap-6">
              {agents.length > 0 ? agents.map(agent => (
                <div key={agent.id} className="w-full md:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)] flex-shrink-0">
                  <AgentCard 
                    agent={agent}
                    code={agentCodes[agent.id]}
                    isStarting={startingAgents.has(agent.id)}
                    isMemoryFlashing={flashingMemories.has(agent.id)}
                    onEdit={handleEditClick}
                    onDelete={handleDeleteClick}
                    onToggle={toggleAgent}
                    onMemory={handleMemoryClick}
                    onShowJupyterModal={() => setIsJupyterModalOpen(true)}
                  />
                </div>
              )) : <GetStarted 
                   onExploreCommunity={() => setActiveTab('community')}
                   onCreateNewAgent={handleAddAgentClick}
                 />}
            </div>
          ) : activeTab === 'community' ? (
            <CommunityTab />
          ) : activeTab === 'models' ? (
            <AvailableModels />
          ) : (
            <div className="text-center p-8">
              <p className="text-gray-500">This feature is coming soon!</p>
            </div>
          )}




        </main>

      {isEditModalOpen && (
        <EditAgentModal 
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          createMode={isCreateMode}
          agent={selectedAgent ? agents.find(a => a.id === selectedAgent) : undefined}
          code={selectedAgent ? agentCodes[selectedAgent] : undefined}
          onSave={handleSaveAgent}
          onImportComplete={fetchAgents}
          setError={setError}
        />
      )}
      
      {isScheduleModalOpen && schedulingAgentId && (
        <ScheduleAgentModal
          agentId={schedulingAgentId}
          isOpen={isScheduleModalOpen}
          onClose={() => {
            setIsScheduleModalOpen(false);
            setSchedulingAgentId(null);
          }}
          onUpdate={fetchAgents}
        />
      )}
      
      {isMemoryManagerOpen && memoryAgentId && (
        <MemoryManager
          agentId={memoryAgentId}
          agentName={agents.find(a => a.id === memoryAgentId)?.name || memoryAgentId}
          isOpen={isMemoryManagerOpen}
          onClose={() => {
            setIsMemoryManagerOpen(false);
            setMemoryAgentId(null);
          }}
        />
      )}

      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t z-30">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex justify-between items-center">
            <div className="flex space-x-3">
              <button 
                className="flex items-center space-x-2 px-4 py-2 bg-gray-100 rounded-md hover:bg-gray-200"
                onClick={() => setShowGlobalLogs(!showGlobalLogs)}
              >
                <Terminal className="h-5 w-5" />
                <span>{showGlobalLogs ? 'Hide System Logs' : 'Show System Logs'}</span>
              </button>
              
              <button 
                className="flex items-center space-x-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100"
                onClick={() => setIsJupyterModalOpen(true)}
              >
                <Server className="h-5 w-5" />
                <span>Configure Jupyter Server</span>
              </button>
            </div>
            
            <div className="flex items-center space-x-4">
              <span className="text-xs text-gray-500">Support the Project!</span>
              <div className="flex items-center space-x-2">
                <a 
                  href="https://discord.gg/wnBb7ZQDUC"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-500 hover:text-indigo-600"
                  title="Join our Discord community"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.127 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                  </svg>
                </a>
                
                <a 
                  href="https://buymeacoffee.com/roy3838"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 hover:text-gray-900"
                  title="Support the project"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
      
      {showGlobalLogs && (
        <GlobalLogsViewer 
          isOpen={showGlobalLogs}
          onClose={() => setShowGlobalLogs(false)}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <Auth0Provider
      domain="dev-mzdd3k678tj1ja86.us.auth0.com"
      clientId="R5iv3RVkWjGZrexFSJ6HqlhSaaGLyFpm"
      authorizationParams={{ redirect_uri: window.location.origin }}
      cacheLocation="localstorage"
      useRefreshTokens={true}
      onRedirectCallback={(appState) => {
        window.history.replaceState(
          {},
          document.title,
          appState?.returnTo || window.location.pathname
        );
      }}
    >
      <AppContent />
    </Auth0Provider>
  );
}

export default App;
