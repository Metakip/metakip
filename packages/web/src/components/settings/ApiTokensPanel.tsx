import * as stylex from '@stylexjs/stylex';
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  type ApiToken,
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
} from '../../hooks/useApiTokens';
import { formatDate } from '../../utils/date';
import { showErrorToast, showSuccessToast } from '../../utils/toast';
import { actionColors } from '../ui/ActionColors.stylex';
import { Dropdown } from '../ui/FormControls';
import { styles } from './ApiTokensPanel.stylex';

export function ApiTokensPanel() {
  const [name, setName] = useState('');
  const [access, setAccess] = useState<'read' | 'comment' | 'write'>('read');
  const [expiryDays, setExpiryDays] = useState('');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const tokensQuery = useApiTokens();
  const createMutation = useCreateApiToken(setCreatedSecret);
  const revokeMutation = useRevokeApiToken();
  const tokens = tokensQuery.data ?? [];

  const createToken = () => {
    if (!name.trim()) return;
    createMutation.mutate(
      {
        name: name.trim(),
        access,
        expiresAt: expiryDays
          ? new Date(Date.now() + Number(expiryDays) * 24 * 60 * 60 * 1000).toISOString()
          : null,
      },
      {
        onSuccess: () => {
          setName('');
          setAccess('read');
          setExpiryDays('');
        },
        onError: (error) => showErrorToast(error.message),
      },
    );
  };

  const revokeToken = (token: ApiToken) => {
    if (!window.confirm(`Revoke “${token.name}”? Applications using it will stop working.`)) return;
    revokeMutation.mutate(token.id, {
      onSuccess: () => showSuccessToast('API token revoked'),
      onError: (error) => showErrorToast(error.message),
    });
  };

  const copySecret = async () => {
    if (!createdSecret) return;
    await navigator.clipboard.writeText(createdSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div {...stylex.props(styles.panel)}>
      <div>
        <h2 {...stylex.props(styles.title)}>API tokens</h2>
        <p {...stylex.props(styles.description)}>
          Create named tokens for the Metakip CLI and local agents. New tokens are read-only by
          default.
        </p>
      </div>

      {createdSecret && (
        <div {...stylex.props(styles.secretNotice)}>
          <p {...stylex.props(styles.secretNoticeText)}>
            Copy this token now. It will not be shown again.
          </p>
          <div {...stylex.props(styles.secretRow)}>
            <input
              readOnly
              value={createdSecret}
              aria-label="New API token"
              {...stylex.props(styles.input, styles.secretInput)}
            />
            <button
              type="button"
              onClick={() => void copySecret()}
              {...stylex.props(actionColors.subdued, styles.copyButton)}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCreatedSecret(null)}
            {...stylex.props(styles.savedButton)}
          >
            I have saved it
          </button>
        </div>
      )}

      <div {...stylex.props(styles.formGrid)}>
        <label {...stylex.props(styles.field)}>
          Token name
          <input
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="Personal terminal"
            {...stylex.props(styles.input, styles.nameInput)}
          />
        </label>
        <div {...stylex.props(styles.field)}>
          Access
          <Dropdown
            value={access}
            onChange={setAccess}
            ariaLabel="Token access"
            options={[
              { value: 'read', label: 'Read only' },
              { value: 'comment', label: 'Read and comment' },
              { value: 'write', label: 'Read, comment, and write' },
            ]}
            rootStyle={styles.dropdown}
            triggerStyle={styles.dropdownTrigger}
          />
        </div>
        <div {...stylex.props(styles.field)}>
          Expiry
          <Dropdown
            value={expiryDays}
            onChange={setExpiryDays}
            ariaLabel="Expiry"
            options={[
              { value: '', label: 'No expiry' },
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '365', label: '1 year' },
            ]}
            rootStyle={styles.dropdown}
            triggerStyle={styles.dropdownTrigger}
          />
        </div>
        <button
          type="button"
          disabled={!name.trim() || createMutation.isPending}
          onClick={createToken}
          {...stylex.props(actionColors.subdued, styles.createButton)}
        >
          <KeyRound size={16} />
          {createMutation.isPending ? 'Creating…' : 'Create token'}
        </button>
      </div>

      <div {...stylex.props(styles.tokenList)}>
        {tokensQuery.isLoading && <p {...stylex.props(styles.tokenState)}>Loading tokens…</p>}
        {tokensQuery.isError && (
          <p {...stylex.props(styles.tokenState, styles.errorState)}>{tokensQuery.error.message}</p>
        )}
        {!tokensQuery.isLoading && !tokensQuery.isError && tokens.length === 0 && (
          <p {...stylex.props(styles.tokenState)}>No API tokens yet.</p>
        )}
        {tokens.map((token, index) => (
          <div
            key={token.id}
            {...stylex.props(
              styles.tokenRow,
              (index > 0 || tokensQuery.isLoading || tokensQuery.isError) &&
                styles.tokenRowSeparated,
            )}
          >
            <div {...stylex.props(styles.tokenInfo)}>
              <p {...stylex.props(styles.tokenName)}>{token.name}</p>
              <p {...stylex.props(styles.tokenDetails)}>
                {[
                  token.scopes.includes('pages:write')
                    ? 'Pages: read, comment, and write'
                    : token.scopes.includes('pages:comment')
                      ? 'Pages: read and comment'
                      : token.scopes.includes('pages:read')
                        ? 'Pages: read'
                        : 'Pages: no access',
                ].join(' · ')}{' '}
                · {token.lastUsedAt ? `Last used ${formatDate(token.lastUsedAt)}` : 'Never used'}
                {token.expiresAt ? ` · Expires ${formatDate(token.expiresAt)}` : ' · No expiry'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => revokeToken(token)}
              aria-label={`Revoke ${token.name}`}
              {...stylex.props(styles.revokeButton)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
