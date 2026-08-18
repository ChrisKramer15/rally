import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../data/repositories/market_data_repository.dart';
import '../../../di/service_locator.dart';
import '../../../domain/models/asset_search_result.dart';
import '../../blocs/market_data/market_data_dashboard_bloc.dart';

/// A search widget for adding assets (stocks and ETFs) to the watchlist.
///
/// Displays a text field with debounced search (300ms). Results are shown
/// in a list below the field. Tapping a result dispatches [AddToWatchlist]
/// to the [MarketDataDashboardBloc] and shows feedback for duplicates or
/// capacity limits.
class WatchlistSearchWidget extends StatefulWidget {
  const WatchlistSearchWidget({super.key});

  @override
  State<WatchlistSearchWidget> createState() => _WatchlistSearchWidgetState();
}

class _WatchlistSearchWidgetState extends State<WatchlistSearchWidget> {
  final TextEditingController _searchController = TextEditingController();
  Timer? _debounceTimer;
  List<AssetSearchResult> _results = [];
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    _debounceTimer?.cancel();

    if (query.trim().isEmpty) {
      setState(() {
        _results = [];
        _isLoading = false;
        _errorMessage = null;
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    _debounceTimer = Timer(const Duration(milliseconds: 300), () {
      _performSearch(query.trim());
    });
  }

  Future<void> _performSearch(String query) async {
    try {
      final repository = sl<MarketDataRepository>();
      final results = await repository.searchAssets(query);
      if (mounted) {
        setState(() {
          _results = results;
          _isLoading = false;
          _errorMessage = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _results = [];
          _isLoading = false;
          _errorMessage = 'Search failed. Please try again.';
        });
      }
    }
  }

  void _onAssetSelected(AssetSearchResult asset) {
    final bloc = context.read<MarketDataDashboardBloc>();
    final currentState = bloc.state;

    // Check for duplicates and capacity from the current BLoC state.
    if (currentState is DashboardLoaded) {
      final allSymbols = {
        ...currentState.prices.keys,
        ...currentState.unavailable,
      };

      if (allSymbols.contains(asset.symbol)) {
        _showFeedback('${asset.symbol} is already on your watchlist');
        return;
      }

      if (allSymbols.length >= 50) {
        _showFeedback('Watchlist is full (maximum 50 assets)');
        return;
      }
    }

    // Dispatch the event to the BLoC.
    bloc.add(AddToWatchlist(asset.symbol));
    _showFeedback('${asset.symbol} added to watchlist');

    // Clear search after selection.
    _searchController.clear();
    setState(() {
      _results = [];
    });
  }

  void _showFeedback(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        duration: const Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildSearchField(context),
        if (_isLoading) _buildLoadingIndicator(),
        if (_errorMessage != null) _buildErrorMessage(context),
        if (_results.isNotEmpty) _buildResultsList(context),
      ],
    );
  }

  Widget _buildSearchField(BuildContext context) {
    return TextField(
      controller: _searchController,
      onChanged: _onSearchChanged,
      decoration: InputDecoration(
        hintText: 'Search stocks and ETFs...',
        prefixIcon: const Icon(Icons.search),
        suffixIcon: _searchController.text.isNotEmpty
            ? IconButton(
                icon: const Icon(Icons.clear),
                onPressed: () {
                  _searchController.clear();
                  _onSearchChanged('');
                },
              )
            : null,
      ),
    );
  }

  Widget _buildLoadingIndicator() {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 16.0),
      child: Center(
        child: SizedBox(
          width: 24,
          height: 24,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ),
    );
  }

  Widget _buildErrorMessage(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Text(
        _errorMessage!,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.error,
            ),
      ),
    );
  }

  Widget _buildResultsList(BuildContext context) {
    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _results.length,
      itemBuilder: (context, index) {
        final asset = _results[index];
        return _SearchResultTile(
          asset: asset,
          onTap: () => _onAssetSelected(asset),
        );
      },
    );
  }
}

/// A single search result tile displaying asset symbol, name, price,
/// and percentage change.
class _SearchResultTile extends StatelessWidget {
  final AssetSearchResult asset;
  final VoidCallback onTap;

  const _SearchResultTile({
    required this.asset,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isPositive = asset.percentageChange > 0;
    final isNegative = asset.percentageChange < 0;

    final changeColor = isPositive
        ? theme.colorScheme.secondary
        : isNegative
            ? theme.colorScheme.error
            : theme.colorScheme.onSurface;

    final changePrefix = isPositive ? '+' : '';

    return ListTile(
      onTap: onTap,
      leading: _buildAssetTypeIcon(context),
      title: Text(
        asset.symbol,
        style: theme.textTheme.titleSmall?.copyWith(
          fontWeight: FontWeight.bold,
        ),
      ),
      subtitle: Text(
        asset.name,
        style: theme.textTheme.bodySmall,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            '\$${asset.currentPrice.toStringAsFixed(2)}',
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          Text(
            '$changePrefix${asset.percentageChange.toStringAsFixed(2)}%',
            style: theme.textTheme.bodySmall?.copyWith(
              color: changeColor,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAssetTypeIcon(BuildContext context) {
    final theme = Theme.of(context);
    final iconData =
        asset.type.name == 'etf' ? Icons.account_balance : Icons.show_chart;
    final label = asset.type.name.toUpperCase();

    return CircleAvatar(
      radius: 18,
      backgroundColor: theme.colorScheme.primary.withValues(alpha: 0.1),
      child: Tooltip(
        message: label,
        child: Icon(
          iconData,
          size: 18,
          color: theme.colorScheme.primary,
        ),
      ),
    );
  }
}
