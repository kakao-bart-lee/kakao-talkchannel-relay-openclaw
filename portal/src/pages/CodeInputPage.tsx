import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';

export default function CodeInputPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const formatCode = (input: string): string => {
    // Remove non-alphanumeric characters
    const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Format as XXXX-XXXX
    if (cleaned.length <= 4) {
      return cleaned;
    }
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCode(e.target.value);
    setCode(formatted);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (code.length !== 9) { // XXXX-XXXX = 9 characters
      setError('코드는 8자리여야 합니다 (XXXX-XXXX)');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.loginWithCode(code);
      navigate('/dashboard');
    } catch (err: any) {
      console.error('Login failed:', err);
      setError(err.message || '코드가 유효하지 않거나 만료되었습니다');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            포털 접속 코드 입력
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            카카오톡에서 /code 명령어로 받은 8자리 코드를 입력하세요
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="code" className="sr-only">
                접속 코드
              </label>
              <input
                id="code"
                name="code"
                type="text"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm text-center tracking-widest font-mono text-lg"
                placeholder="XXXX-XXXX"
                value={code}
                onChange={handleCodeChange}
                maxLength={9}
                autoComplete="off"
                disabled={loading}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">
                    {error}
                  </h3>
                </div>
              </div>
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading || code.length !== 9}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </div>
        </form>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h3 className="text-sm font-medium text-blue-900 mb-2">
            💡 코드 받는 방법
          </h3>
          <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
            <li>카카오톡 채팅방에서 /code 입력</li>
            <li>받은 8자리 코드를 위에 입력</li>
            <li>코드는 30분 동안 유효합니다</li>
          </ol>
        </div>

        <div className="text-center text-xs text-gray-500">
          <p>
            이 코드로 대화 내역과 통계를 조회할 수 있습니다 (읽기 전용)
          </p>
        </div>
      </div>
    </div>
  );
}
