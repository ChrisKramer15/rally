import 'package:flutter/material.dart';

import '../../../domain/models/enums.dart';

/// Displays connection status banners for the Market Data Dashboard.
///
/// Visibility logic:
/// - [ConnectionStatus.connected]: invisible (`SizedBox.shrink()`)
/// - [ConnectionStatus.disconnected]: warning banner with last received timestamp
/// - [ConnectionStatus.reconnecting]: reconnecting indicator with attempt number
/// - When all retries exhausted (reconnectAttempt > 10): persistent error banner
///   with manual retry button
class ConnectionBannerWidget extends StatelessWidget {
  /// Current WebSocket connection status.
  final ConnectionStatus connectionStatus;

  /// Current reconnection attempt number, or null when connected.
  final int? reconnectAttempt;

  /// Timestamp of the most recently received price data.
  final DateTime? lastDataReceived;

  /// Callback invoked when the user presses the retry button.
  final VoidCallback? onRetry;

  /// Maximum number of reconnection attempts before showing error state.
  static const int maxRetryAttempts = 10;

  const ConnectionBannerWidget({
    super.key,
    required this.connectionStatus,
    this.reconnectAttempt,
    this.lastDataReceived,
    this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    // When retries are exhausted, show persistent error banner.
    if (reconnectAttempt != null && reconnectAttempt! > maxRetryAttempts) {
      return _buildErrorBanner(context);
    }

    switch (connectionStatus) {
      case ConnectionStatus.connected:
        return const SizedBox.shrink();
      case ConnectionStatus.disconnected:
        return _buildDisconnectedBanner(context);
      case ConnectionStatus.reconnecting:
        return _buildReconnectingBanner(context);
    }
  }

  /// Builds the warning banner shown when disconnected.
  Widget _buildDisconnectedBanner(BuildContext context) {
    final timestampText = _formatLastReceived();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.amber.shade800.withValues(alpha: 0.15),
        border: Border(
          bottom: BorderSide(
            color: Colors.amber.shade700,
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.warning_amber_rounded,
            color: Colors.amber.shade700,
            size: 20,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Live data unavailable',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: Colors.amber.shade700,
                      ),
                ),
                if (timestampText != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    timestampText,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Colors.amber.shade600,
                        ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Builds the reconnecting banner with attempt number.
  Widget _buildReconnectingBanner(BuildContext context) {
    final attempt = reconnectAttempt ?? 1;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.amber.shade800.withValues(alpha: 0.15),
        border: Border(
          bottom: BorderSide(
            color: Colors.amber.shade700,
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Colors.amber.shade700,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Reconnecting... attempt $attempt/$maxRetryAttempts',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Colors.amber.shade700,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  /// Builds the persistent error banner when all retries are exhausted.
  Widget _buildErrorBanner(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.red.shade900.withValues(alpha: 0.15),
        border: Border(
          bottom: BorderSide(
            color: Colors.red.shade700,
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.error_outline,
            color: Colors.red.shade700,
            size: 20,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Connection failed',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: Colors.red.shade700,
                  ),
            ),
          ),
          if (onRetry != null)
            TextButton(
              onPressed: onRetry,
              style: TextButton.styleFrom(
                foregroundColor: Colors.red.shade700,
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              ),
              child: const Text('Retry'),
            ),
        ],
      ),
    );
  }

  /// Formats the [lastDataReceived] timestamp as "Last updated: HH:mm:ss".
  /// Returns null if [lastDataReceived] is null.
  String? _formatLastReceived() {
    if (lastDataReceived == null) return null;
    final dt = lastDataReceived!;
    final hh = dt.hour.toString().padLeft(2, '0');
    final mm = dt.minute.toString().padLeft(2, '0');
    final ss = dt.second.toString().padLeft(2, '0');
    return 'Last updated: $hh:$mm:$ss';
  }
}
