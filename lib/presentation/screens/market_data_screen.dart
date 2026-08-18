import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../domain/models/asset_price.dart';
import '../../domain/models/asset_search_result.dart';
import '../blocs/market_data_bloc.dart';
import '../theme/neon_theme.dart';

/// Market data screen providing asset search and detail views.
///
/// Features:
/// - Search input with minimum 1-character threshold (Requirement 2.3)
/// - Search results showing symbol, name, current price, percentage change (Requirement 2.2)
/// - Asset detail view with price, daily high/low, volume, percentage change (Requirement 2.4)
/// - Connection warning banner when WebSocket is disconnected (Requirement 2.6)
/// - No results message (Requirement 2.7)
class MarketDataScreen extends StatefulWidget {
  const MarketDataScreen({super.key});

  @override
  State<MarketDataScreen> createState() => _MarketDataScreenState();
}

class _MarketDataScreenState extends State<MarketDataScreen> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    if (query.isNotEmpty) {
      context.read<MarketDataBloc>().add(SearchAsset(query));
    }
  }

  void _onAssetSelected(String symbol) {
    context.read<MarketDataBloc>().add(SelectAsset(symbol));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Market Data'),
      ),
      body: Column(
        children: [
          _buildConnectionBanner(),
          _buildSearchInput(),
          Expanded(child: _buildContent()),
        ],
      ),
    );
  }

  /// Displays a warning banner when the WebSocket connection is lost.
  Widget _buildConnectionBanner() {
    return BlocBuilder<MarketDataBloc, MarketDataState>(
      buildWhen: (previous, current) =>
          current is ConnectionWarning ||
          (previous is ConnectionWarning && current is! ConnectionWarning),
      builder: (context, state) {
        if (state is ConnectionWarning) {
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 10.0),
            color: NeonColors.darkShortRed.withValues(alpha: 0.15),
            child: Row(
              children: [
                Icon(
                  Icons.wifi_off,
                  color: NeonColors.shortRed(Theme.of(context).brightness),
                  size: 20,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Connection lost. Showing last data from '
                    '${_formatTimestamp(state.lastUpdated)}',
                    style: TextStyle(
                      color: NeonColors.shortRed(Theme.of(context).brightness),
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
          );
        }
        return const SizedBox.shrink();
      },
    );
  }

  /// Builds the search text input field.
  Widget _buildSearchInput() {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: TextField(
        controller: _searchController,
        onChanged: _onSearchChanged,
        decoration: const InputDecoration(
          hintText: 'Search stocks, ETFs, crypto...',
          prefixIcon: Icon(Icons.search),
        ),
      ),
    );
  }

  /// Builds the main content area based on the current BLoC state.
  Widget _buildContent() {
    return BlocBuilder<MarketDataBloc, MarketDataState>(
      buildWhen: (previous, current) => current is! ConnectionWarning,
      builder: (context, state) {
        return switch (state) {
          MarketDataInitial() => _buildInitialState(),
          Searching() => const Center(child: CircularProgressIndicator()),
          SearchResults(:final results) => _buildSearchResults(results),
          NoResults() => _buildNoResults(),
          AssetDetail(:final assetPrice) => _buildAssetDetail(assetPrice),
          MarketDataError(:final message) => _buildError(message),
          ConnectionWarning() => _buildInitialState(),
        };
      },
    );
  }

  /// Placeholder shown before any search is performed.
  Widget _buildInitialState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.trending_up,
            size: 64,
            color: NeonColors.accent(Theme.of(context).brightness),
          ),
          const SizedBox(height: 16),
          Text(
            'Search for an asset to get started',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
        ],
      ),
    );
  }

  /// Displays the list of search results.
  Widget _buildSearchResults(List<AssetSearchResult> results) {
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 16.0),
      itemCount: results.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final result = results[index];
        return _SearchResultTile(
          result: result,
          onTap: () => _onAssetSelected(result.symbol),
        );
      },
    );
  }

  /// Displays a "no results found" message.
  Widget _buildNoResults() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.search_off,
            size: 64,
            color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.4),
          ),
          const SizedBox(height: 16),
          Text(
            'No results found',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            'Try a different search term',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }

  /// Displays the asset detail view with price, high/low, volume, and change.
  Widget _buildAssetDetail(AssetPrice asset) {
    final brightness = Theme.of(context).brightness;
    final isPositive = asset.percentageChange >= 0;
    final changeColor = isPositive
        ? NeonColors.buyGreen(brightness)
        : NeonColors.shortRed(brightness);
    final changeIcon = isPositive ? Icons.arrow_upward : Icons.arrow_downward;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Back button row
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () {
                  // Re-trigger search if text is present, otherwise reset
                  final query = _searchController.text;
                  if (query.isNotEmpty) {
                    context.read<MarketDataBloc>().add(SearchAsset(query));
                  }
                },
              ),
              Text(
                asset.symbol,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Current price
          Text(
            '\$${asset.price.toStringAsFixed(2)}',
            style: Theme.of(context).textTheme.displaySmall?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          const SizedBox(height: 8),

          // Percentage change with directional icon
          Row(
            children: [
              Icon(changeIcon, color: changeColor, size: 20),
              const SizedBox(width: 4),
              Text(
                '${isPositive ? '+' : ''}${asset.percentageChange.toStringAsFixed(2)}%',
                style: TextStyle(
                  color: changeColor,
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 32),

          // Detail cards
          _buildDetailRow('Daily High', '\$${asset.dailyHigh.toStringAsFixed(2)}'),
          const SizedBox(height: 12),
          _buildDetailRow('Daily Low', '\$${asset.dailyLow.toStringAsFixed(2)}'),
          const SizedBox(height: 12),
          _buildDetailRow('Volume', _formatVolume(asset.volume)),
          const SizedBox(height: 12),
          _buildDetailRow(
            'Change',
            '${isPositive ? '+' : ''}${asset.percentageChange.toStringAsFixed(2)}%',
            valueColor: changeColor,
          ),
        ],
      ),
    );
  }

  /// Builds a label-value row for the asset detail view.
  Widget _buildDetailRow(String label, String value, {Color? valueColor}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(8.0),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          Text(
            value,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: valueColor,
                ),
          ),
        ],
      ),
    );
  }

  /// Displays an error message.
  Widget _buildError(String message) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.error_outline,
            size: 64,
            color: NeonColors.shortRed(Theme.of(context).brightness),
          ),
          const SizedBox(height: 16),
          Text(
            'Something went wrong',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            message,
            style: Theme.of(context).textTheme.bodyMedium,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  /// Formats volume with K/M/B suffixes for readability.
  String _formatVolume(double volume) {
    if (volume >= 1e9) {
      return '${(volume / 1e9).toStringAsFixed(2)}B';
    } else if (volume >= 1e6) {
      return '${(volume / 1e6).toStringAsFixed(2)}M';
    } else if (volume >= 1e3) {
      return '${(volume / 1e3).toStringAsFixed(2)}K';
    }
    return volume.toStringAsFixed(2);
  }

  /// Formats a [DateTime] as HH:mm:ss.
  String _formatTimestamp(DateTime timestamp) {
    return '${timestamp.hour.toString().padLeft(2, '0')}:'
        '${timestamp.minute.toString().padLeft(2, '0')}:'
        '${timestamp.second.toString().padLeft(2, '0')}';
  }
}

/// A single search result tile showing symbol, name, price, and change.
class _SearchResultTile extends StatelessWidget {
  final AssetSearchResult result;
  final VoidCallback onTap;

  const _SearchResultTile({
    required this.result,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isPositive = result.percentageChange >= 0;
    final changeColor = isPositive
        ? NeonColors.buyGreen(brightness)
        : NeonColors.shortRed(brightness);
    final changeIcon = isPositive ? Icons.arrow_upward : Icons.arrow_downward;

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(vertical: 4.0),
      onTap: onTap,
      title: Row(
        children: [
          Text(
            result.symbol,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              result.name,
              style: Theme.of(context).textTheme.bodyMedium,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            '\$${result.currentPrice.toStringAsFixed(2)}',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
          ),
          const SizedBox(height: 2),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(changeIcon, color: changeColor, size: 14),
              const SizedBox(width: 2),
              Text(
                '${isPositive ? '+' : ''}${result.percentageChange.toStringAsFixed(2)}%',
                style: TextStyle(
                  color: changeColor,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
