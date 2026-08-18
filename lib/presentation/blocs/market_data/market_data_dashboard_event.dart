import 'package:equatable/equatable.dart';

import '../../../domain/models/enums.dart';
import '../../../domain/models/price_update.dart';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Base class for all MarketDataDashboard events.
sealed class MarketDataDashboardEvent extends Equatable {
  const MarketDataDashboardEvent();

  @override
  List<Object?> get props => [];
}

/// Loads the watchlist, subscribes to all symbols, and starts listening.
class DashboardOpened extends MarketDataDashboardEvent {
  const DashboardOpened();
}

/// Unsubscribes all streams, stops polling, and cancels timers.
class DashboardClosed extends MarketDataDashboardEvent {
  const DashboardClosed();
}

/// Adds a symbol to the watchlist and subscribes to its price stream.
class AddToWatchlist extends MarketDataDashboardEvent {
  final String symbol;

  const AddToWatchlist(this.symbol);

  @override
  List<Object?> get props => [symbol];
}

/// Removes a symbol from the watchlist and unsubscribes from its stream.
class RemoveFromWatchlist extends MarketDataDashboardEvent {
  final String symbol;

  const RemoveFromWatchlist(this.symbol);

  @override
  List<Object?> get props => [symbol];
}

/// Internal event: a new price update was received from the WebSocket.
class PriceUpdated extends MarketDataDashboardEvent {
  final PriceUpdate priceUpdate;

  const PriceUpdated(this.priceUpdate);

  @override
  List<Object?> get props => [priceUpdate];
}

/// Internal event: the WebSocket connection status changed.
class ConnectionChanged extends MarketDataDashboardEvent {
  final ConnectionStatus connectionStatus;

  const ConnectionChanged(this.connectionStatus);

  @override
  List<Object?> get props => [connectionStatus];
}

/// Internal event: periodic timer fired to re-evaluate price staleness.
class StaleCheckTriggered extends MarketDataDashboardEvent {
  const StaleCheckTriggered();
}

/// User pressed retry after all reconnection attempts were exhausted.
class ManualRetryRequested extends MarketDataDashboardEvent {
  const ManualRetryRequested();
}
