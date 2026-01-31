import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { Plus, Trash2, RefreshCw, Copy, Check } from 'lucide-react';

export function AccountsPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newAccountData, setNewAccountData] = useState({ openclawUserId: '', mode: 'development', rateLimitPerMinute: 60 });
  
  const [tokenDialog, setTokenDialog] = useState<{ open: boolean; token: string }>({ open: false, token: '' });
  const [copied, setCopied] = useState(false);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const data = await api.getAccounts(limit, offset);
      setAccounts(data.items);
      setTotal(data.total);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [offset]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.createAccount(newAccountData);
      setIsCreateOpen(false);
      setTokenDialog({ open: true, token: res.relayToken });
      fetchAccounts();
      setNewAccountData({ openclawUserId: '', mode: 'development', rateLimitPerMinute: 60 });
    } catch (error) {
      alert('Failed to create account');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure? This will delete all mappings and messages associated with this account.')) return;
    try {
      await api.deleteAccount(id);
      fetchAccounts();
    } catch (error) {
      alert('Failed to delete account');
    }
  };

  const handleRegenerateToken = async (id: string) => {
    if (!confirm('Regenerate token? The old token will stop working immediately.')) return;
    try {
      const res = await api.regenerateToken(id);
      setTokenDialog({ open: true, token: res.relayToken });
    } catch (error) {
      alert('Failed to regenerate token');
    }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(tokenDialog.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Accounts</h1>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Create Account
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>OpenClaw User ID</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Rate Limit</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-24">Loading...</TableCell>
              </TableRow>
            ) : accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-24">No accounts found</TableCell>
              </TableRow>
            ) : (
              accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-mono text-xs">{account.id}</TableCell>
                  <TableCell>{account.openclawUserId || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={account.mode === 'production' ? 'default' : 'secondary'}>
                      {account.mode}
                    </Badge>
                  </TableCell>
                  <TableCell>{account.rateLimitPerMinute}/min</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(account.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="ghost" size="icon" onClick={() => handleRegenerateToken(account.id)} title="Regenerate Token">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(account.id)} title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end space-x-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOffset(Math.max(0, offset - limit))}
          disabled={offset === 0}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOffset(offset + limit)}
          disabled={offset + limit >= total}
        >
          Next
        </Button>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Account</DialogTitle>
            <DialogDescription>Add a new relay account.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">OpenClaw User ID (Optional)</label>
              <Input
                value={newAccountData.openclawUserId}
                onChange={(e) => setNewAccountData({ ...newAccountData, openclawUserId: e.target.value })}
                placeholder="e.g. user_123"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Mode</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newAccountData.mode}
                onChange={(e) => setNewAccountData({ ...newAccountData, mode: e.target.value })}
              >
                <option value="development">Development</option>
                <option value="production">Production</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Rate Limit (per minute)</label>
              <Input
                type="number"
                value={newAccountData.rateLimitPerMinute}
                onChange={(e) => setNewAccountData({ ...newAccountData, rateLimitPerMinute: parseInt(e.target.value) })}
              />
            </div>
            <DialogFooter>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={tokenDialog.open} onOpenChange={(open) => setTokenDialog({ ...tokenDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Relay Token</DialogTitle>
            <DialogDescription>
              Copy this token now. You won't be able to see it again!
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 mt-4">
            <code className="flex-1 rounded bg-muted p-2 font-mono text-sm break-all">
              {tokenDialog.token}
            </code>
            <Button size="icon" onClick={copyToken}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setTokenDialog({ ...tokenDialog, open: false })}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
