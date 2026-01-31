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
      setConnections(connectionsData.connections);
    } catch (error) {
      navigate('/login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await api.logout();
    navigate('/login');
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
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Button variant="outline" onClick={handleLogout}>Logout</Button>
          </div>
        </div>

        {/* Connection Guide */}
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>카카오톡 챗봇 연결 가이드</span>
            </CardTitle>
            <CardDescription>
              아래 단계를 따라 AI 챗봇을 카카오톡에 연결하세요
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">1</div>
                <div>
                  <p className="font-medium">카카오톡 채널 추가</p>
                  <p className="text-sm text-muted-foreground">
                    아래 링크를 클릭하여 카카오톡 채널을 친구로 추가하세요.
                  </p>
                  <a
                    href="https://pf.kakao.com/_scexbC"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-primary hover:underline font-medium"
                  >
                    https://pf.kakao.com/_scexbC →
                  </a>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">2</div>
                <div>
                  <p className="font-medium">페어링 코드 생성</p>
                  <p className="text-sm text-muted-foreground">
                    아래에서 "Generate New Code" 버튼을 클릭하여 6자리 페어링 코드를 생성하세요.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">3</div>
                <div>
                  <p className="font-medium">챗봇에 코드 전송</p>
                  <p className="text-sm text-muted-foreground">
                    카카오톡 채널 채팅창에서 생성된 6자리 코드를 입력하면 연결이 완료됩니다.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Pairing Code</CardTitle>
              <CardDescription>
                페어링 코드를 생성하여 카카오톡 채널과 연결하세요
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {pairingCode ? (
                <div className="text-center space-y-4">
                  <div className="text-4xl font-mono font-bold tracking-wider p-4 bg-primary text-primary-foreground rounded-lg">
                    {pairingCode}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    이 코드를 카카오톡 채팅창에 입력하세요
                  </p>
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
                연결된 카카오톡 대화 목록
              </CardDescription>
            </CardHeader>
            <CardContent>
              {connections.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  연결된 대화가 없습니다
                </div>
              ) : (
                <div className="space-y-4">
                  {connections.map((conn) => (
                    <div key={conn.conversationKey} className="flex items-center justify-between p-3 bg-card border rounded-lg">
                      <div className="truncate mr-4">
                        <div className="font-medium truncate">{conn.conversationKey}</div>
                        <div className="text-xs text-muted-foreground">
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
