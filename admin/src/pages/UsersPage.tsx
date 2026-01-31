import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, UserX, UserCheck, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { api, type PortalUser } from '../lib/api';

const PAGE_SIZE = 20;

export function UsersPage(): React.ReactElement {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadUsers = useCallback(async (currentPage: number): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const offset = currentPage * PAGE_SIZE;
      const { items, total: totalCount } = await api.getUsers(PAGE_SIZE, offset);
      setUsers(items);
      setTotal(totalCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : '사용자를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers(page);
  }, [page, loadUsers]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleToggleActive = async (user: PortalUser) => {
    const action = user.isActive ? '비활성화' : '활성화';
    if (!confirm(`"${user.email}" 사용자를 ${action}하시겠습니까?`)) {
      return;
    }

    setActionLoading(user.id);
    try {
      const updated = await api.updateUser(user.id, { isActive: !user.isActive });
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? updated : u))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : '작업에 실패했습니다.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (user: PortalUser) => {
    if (!confirm(`"${user.email}" 사용자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }

    setActionLoading(user.id);
    try {
      await api.deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">사용자를 불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">사용자 관리</h1>
          <p className="text-muted-foreground">Portal 사용자를 관리합니다.</p>
        </div>
        <Button variant="outline" onClick={() => loadUsers(page)} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>사용자 목록 (총 {total}명)</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              등록된 사용자가 없습니다.
            </div>
          ) : (
            <div className="space-y-3">
              {users.map((user) => {
                const isLoading = actionLoading === user.id;

                return (
                  <div
                    key={user.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{user.email}</span>
                        <Badge variant={user.isActive ? 'default' : 'secondary'}>
                          {user.isActive ? '활성' : '비활성'}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        가입일: {new Date(user.createdAt).toLocaleDateString('ko-KR')}
                        {user.lastLoginAt && (
                          <> · 마지막 로그인: {new Date(user.lastLoginAt).toLocaleString('ko-KR')}</>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleActive(user)}
                        disabled={isLoading}
                      >
                        {user.isActive ? (
                          <>
                            <UserX className="mr-2 h-4 w-4" />
                            비활성화
                          </>
                        ) : (
                          <>
                            <UserCheck className="mr-2 h-4 w-4" />
                            활성화
                          </>
                        )}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(user)}
                        disabled={isLoading}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        삭제
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">
                {page * PAGE_SIZE + 1} - {Math.min((page + 1) * PAGE_SIZE, total)} / {total}명
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                >
                  <ChevronLeft className="h-4 w-4" />
                  이전
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1 || loading}
                >
                  다음
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
