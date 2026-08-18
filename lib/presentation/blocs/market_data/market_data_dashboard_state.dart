import 'package:equatable/equatable.dart';

import '../../../domain/models/asset_price.dart';
import '../../../domain/models/enums.dart';

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/// Base class for all MarketDataDashboard states.
sealed class MarketDataDashboardState extends Equatable {
  const MarketDataDashboardState();

  @override
  List<Object?> get props => [];
}

/// Initial load in progress.
class DashboardLoading extends MarketDataDashboardState {
  const DashboardLoading();
}

/// Active state with watchlist prices and connection status.
class DashboardLoaded extends MarketDataDashboardState {
  /// Current prices keyed by symbol.
  final Map<String, AssetPrice> prices;

  /// Symbols whose cached price is stale (older than 60 seconds).
  final Set<String> stalePrices;

  /// Symbols with no data received yet.
  final Set<String> unavailable;

  /// Current WebSocket connection status.
  final ConnectionStatus connectionStatus;

  /// Current reconnection attempt number, or null when connected.
  final int? reconnectAttempt;

  /// Timestamp of the most recently received price data.
  final DateTime? lastDataReceived;

  const DashboardLoaded({
    required this.prices,
    this.stalePrices = const {},
    this.unavailable = const {},
    this.connectionStatus = ConnectionStatus.connected,
    this.reconnectAttempt,
    this.lastDataReceived,
  });

  /// Creates a copy with the given fields replaced.
  DashboardLoaded copyWith({
    Map<String, AssetPrice>? prices,
    Set<String>? stalePrices,
    Set<String>? unavailable,
    ConnectionStatus? connectionStatus,
    int? Function()? reconnectAttempt,
    DateTime? Function()? lastDataReceived,
  }) {
    return DashboardLoaded(
      prices: prices ?? this.prices,
      stalePrices: stalePrices ?? this.stalePrices,
      unavailable: unavailable ?? this.unavailable,
      connectionStatus: connectionStatus ?? this.connectionStatus,
      reconnectAttempt:
          reconnectAttempt != null ? reconnectAttempt() : this.reconnectAttempt,
      lastDataReceived: lastDataReceived != null
          ? lastDataReceived()
          : this.lastDataReceived,
    );
  }

  @override
  List<Object?> get props => [
        prices,
        stalePrices,
        unavailable,
        connectionStatus,
        reconnectAttempt,
        lastDataReceived,
      ];
}

/// Watchlist is empty — show prompt to add assets.
class DashboardEmpty extends MarketDataDashboardState {
  const DashboardEmpty();
}

/// An unrecoverable error occurred.
class DashboardError extends MarketDataDashboardState {
  final String message;

  const DashboardError(this.message);

  @override
  List<Object?> get props => [message];
}
