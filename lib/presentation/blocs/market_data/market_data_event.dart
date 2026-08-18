import 'package:equatable/equatable.dart';

import '../../../domain/models/enums.dart';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Base class for all MarketData events.
sealed class MarketDataEvent extends Equatable {
  const MarketDataEvent();

  @override
  List<Object?> get props => [];
}

/// Triggers a search for assets matching [query].
class SearchAsset extends MarketDataEvent {
  final String query;

  const SearchAsset(this.query);

  @override
  List<Object?> get props => [query];
}

/// Selects an asset by [symbol] to load detailed price info.
class SelectAsset extends MarketDataEvent {
  final String symbol;

  const SelectAsset(this.symbol);

  @override
  List<Object?> get props => [symbol];
}

/// Subscribes to real-time price updates for a set of [symbols].
class SubscribeSymbols extends MarketDataEvent {
  final Set<String> symbols;

  const SubscribeSymbols(this.symbols);

  @override
  List<Object?> get props => [symbols];
}

/// Internal event triggered when the connection status changes.
class ConnectionStatusChanged extends MarketDataEvent {
  final ConnectionStatus status;

  const ConnectionStatusChanged(this.status);

  @override
  List<Object?> get props => [status];
}
