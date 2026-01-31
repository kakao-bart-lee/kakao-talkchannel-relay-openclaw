import React, { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { AlertTriangle, Lock, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { api, type User } from '../lib/api';

interface LayoutContext {
  user: User | null;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user } = useOutletContext<LayoutContext>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">설정</h1>
        <p className="text-muted-foreground">
          계정 설정을 관리합니다.
        </p>
      </div>

      {/* Account Info */}
      <Card>
        <CardHeader>
          <CardTitle>계정 정보</CardTitle>
          <CardDescription>현재 로그인된 계정 정보</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">이메일</span>
              <span className="text-sm font-medium">{user?.email}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Password Change */}
      <PasswordChangeCard />

      {/* Account Deletion */}
      <AccountDeletionCard onDeleted={() => navigate('/login')} />
    </div>
  );
}

function PasswordChangeCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    if (newPassword.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }

    setLoading(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '비밀번호 변경에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          비밀번호 변경
        </CardTitle>
        <CardDescription>
          계정 보안을 위해 주기적으로 비밀번호를 변경하세요.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-3 text-sm text-green-600">
              비밀번호가 성공적으로 변경되었습니다.
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="currentPassword" className="text-sm font-medium">
              현재 비밀번호
            </label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="newPassword" className="text-sm font-medium">
              새 비밀번호
            </label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="8자 이상"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              새 비밀번호 확인
            </label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <Button type="submit" disabled={loading}>
            {loading ? '변경 중...' : '비밀번호 변경'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AccountDeletionCard({ onDeleted }: { onDeleted: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (confirmText !== '계정 삭제') {
      setError('"계정 삭제"를 정확히 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      await api.deleteAccount(password);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : '계정 삭제에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Trash2 className="h-5 w-5" />
          계정 삭제
        </CardTitle>
        <CardDescription>
          계정을 삭제하면 모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!showForm ? (
          <Button
            variant="destructive"
            onClick={() => setShowForm(true)}
          >
            계정 삭제 진행
          </Button>
        ) : (
          <form onSubmit={handleDelete} className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <p className="font-medium">주의: 이 작업은 되돌릴 수 없습니다!</p>
                <p className="mt-1">
                  계정 삭제 시 모든 연결, 메시지 기록, API 토큰이 영구적으로 삭제됩니다.
                </p>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="deletePassword" className="text-sm font-medium">
                비밀번호 확인
              </label>
              <Input
                id="deletePassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmText" className="text-sm font-medium">
                확인을 위해 <span className="font-bold">"계정 삭제"</span>를 입력하세요
              </label>
              <Input
                id="confirmText"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="계정 삭제"
                required
              />
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setPassword('');
                  setConfirmText('');
                  setError(null);
                }}
              >
                취소
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={loading || confirmText !== '계정 삭제'}
              >
                {loading ? '삭제 중...' : '계정 영구 삭제'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
