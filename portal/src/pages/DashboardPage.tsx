import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { api, type User, type Connection } from '../lib/api';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [userData, connectionsData] = await Promise.all([
        api.me(),
        api.getConnections()
      ]);
      setUser(userData);
      setConnections(connectionsData);
    } catch (error) {
      navigate('/portal/login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await api.logout();
    navigate('/portal/login');
  };

  const generateCode = async () => {
    try {
      const { code } = await api.generatePairingCode();
      setPairingCode(code);
    } catch (error) {
      console.error('Failed to generate code', error);
    }
  };

  const copyCode = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user?.email}</span>
            <Button variant="outline" onClick={handleLogout}>Logout</Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Pairing Code</CardTitle>
              <CardDescription>
                Generate a code to connect your KakaoTalk channel
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {pairingCode ? (
                <div className="text-center space-y-4">
                  <div className="text-4xl font-mono font-bold tracking-wider p-4 bg-gray-100 rounded-lg">
                    {pairingCode}
                  </div>
                  <Button onClick={copyCode} variant="secondary" className="w-full">
                    Copy Code
                  </Button>
                  <Button onClick={() => setPairingCode(null)} variant="ghost" size="sm">
                    Close
                  </Button>
                </div>
              ) : (
                <Button onClick={generateCode} className="w-full">
                  Generate New Code
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active Connections</CardTitle>
              <CardDescription>
                Your connected KakaoTalk conversations
              </CardDescription>
            </CardHeader>
            <CardContent>
              {connections.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  No active connections
                </div>
              ) : (
                <div className="space-y-4">
                  {connections.map((conn) => (
                    <div key={conn.conversationKey} className="flex items-center justify-between p-3 bg-white border rounded-lg">
                      <div className="truncate mr-4">
                        <div className="font-medium truncate">{conn.conversationKey}</div>
                        <div className="text-xs text-gray-500">
                          Last seen: {new Date(conn.lastSeenAt).toLocaleString()}
                        </div>
                      </div>
                      <Badge variant={conn.state === 'active' ? 'default' : 'secondary'}>
                        {conn.state}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
