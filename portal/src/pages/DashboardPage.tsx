import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { api, type User, type Connection } from '../lib/api';

interface LayoutContext {
  user: User | null;
}

export default function DashboardPage() {
  const { user } = useOutletContext<LayoutContext>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getConnections()
      .then(setConnections)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const generateCode = async () => {
    try {
      const { code } = await api.generatePairingCode();
      setPairingCode(code);
    } catch (error) {
      console.error('Failed to generate code', error);
    }
  };

  const copyCode = async () => {
    if (pairingCode) {
      await navigator.clipboard.writeText(pairingCode);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">연결 정보를 불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">대시보드</h1>
        <p className="text-muted-foreground">
          {user?.email}님, 환영합니다.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Pairing Code Card */}
        <Card>
          <CardHeader>
            <CardTitle>페어링 코드</CardTitle>
            <CardDescription>
              카카오톡 채널을 연결하기 위한 코드를 생성하세요
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {pairingCode ? (
              <div className="space-y-4 text-center">
                <div className="rounded-lg bg-muted p-4 font-mono text-4xl font-bold tracking-wider">
                  {pairingCode}
                </div>
                <Button onClick={copyCode} variant="secondary" className="w-full">
                  코드 복사
                </Button>
                <Button onClick={() => setPairingCode(null)} variant="ghost" size="sm">
                  닫기
                </Button>
              </div>
            ) : (
              <Button onClick={generateCode} className="w-full">
                새 코드 생성
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Connections Card */}
        <Card>
          <CardHeader>
            <CardTitle>활성 연결</CardTitle>
            <CardDescription>
              연결된 카카오톡 대화 목록
            </CardDescription>
          </CardHeader>
          <CardContent>
            {connections.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                연결된 대화가 없습니다
              </div>
            ) : (
              <div className="space-y-3">
                {connections.map((conn) => (
                  <div
                    key={conn.conversationKey}
                    className="flex items-center justify-between rounded-lg border bg-card p-3"
                  >
                    <div className="mr-4 min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {conn.conversationKey}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        마지막 활동: {new Date(conn.lastSeenAt).toLocaleString('ko-KR')}
                      </div>
                    </div>
                    <Badge variant={conn.state === 'active' ? 'default' : 'secondary'}>
                      {conn.state === 'active' ? '활성' : conn.state}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
