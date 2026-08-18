import 'package:equatable/equatable.dart';

import '../../../domain/models/asset_price.dart';
import '../../../domain/models/asset_search_result.dart';

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/// Base class for all MarketData states.
sealed class MarketDataState extends Equatable {
  const MarketDataState();

  @override
  List<Object?> get props => [];
}

/// Initial state before any interaction.
class MarketDataInitial extends MarketDataState {
  const MarketDataInitial();
}

/// Searching for assets (loading state).
class Searching extends MarketDataState {
  const Searching();
}

/// Search completed with results.
class SearchResults extends MarketDataState {
  final List<AssetSearchResult> results;

  const SearchResults(this.results);

  @override
  List<Object?> get props => [results];
}

/// Search returned no matching assets.
class NoResults extends MarketDataState {
  const NoResults();
}

/// Asset detail loaded for a selected symbol.
class AssetDetail extends MarketDataState {
  final AssetPrice assetPrice;

  const AssetDetail(this.assetPrice);

  @override
  List<Object?> get props => [assetPrice];
}

/// An error occurred while performing a market data operation.
class MarketDataError extends MarketDataState {
  final String message;

  const MarketDataError(this.message);

  @override
  List<Object?> get props => [message];
}

/// Connection to market data service was lost.
class ConnectionWarning extends MarketDataState {
  final DateTime lastUpdated;

  const ConnectionWarning(this.lastUpdated);

  @override
  List<Object?> get props => [lastUpdated];
}
