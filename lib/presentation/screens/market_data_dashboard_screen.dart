import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../data/repositories/market_data_repository.dart';
import '../../di/service_locator.dart';
import '../../domain/services/i_watchlist_store.dart';
import '../blocs/market_data/market_data_dashboard_bloc.dart';
import '../widgets/market_data/connection_banner_widget.dart';
import '../widgets/market_data/price_ticker_widget.dart';
import '../widgets/market_data/watchlist_search_widget.dart';

/// The main Market Data Dashboard screen displaying live price data
/// for the user's curated watchlist.
///
/// Integrates:
/// - [MarketDataDashboardBloc] via [BlocProvider]
/// - [ConnectionBannerWidget] for connection status display
/// - [PriceTickerWidget] for each watchlist asset
/// - [WatchlistSearchWidget] for adding assets via search
///
/// Dispatches [DashboardOpened] on init and [DashboardClosed] on dispose.
class MarketDataDashboardScreen extends StatefulWidget {
  const MarketDataDashboardScreen({super.key});

  @override
  State<MarketDataDashboardScreen> createState() =>
      _MarketDataDashboardScreenState();
}

class _MarketDataDashboardScreenState extends State<MarketDataDashboardScreen> {
  late final MarketDataDashboardBloc _bloc;

  @override
  void initState() {
    super.initState();
    _bloc = MarketDataDashboardBloc(
      watchlistStore: sl<IWatchlistStore>(),
      repository: sl<MarketDataRepository>(),
    );
    _bloc.add(const DashboardOpened());
  }

  @override
  void dispose() {
    _bloc.add(const DashboardClosed());
    _bloc.close();
    super.dispose();
  }

  void _showSearchBottomSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (bottomSheetContext) {
        return BlocProvider.value(
          value: _bloc,
          child: Padding(
            padding: EdgeInsets.only(
              left: 16,
              right: 16,
              top: 16,
              bottom: MediaQuery.of(bottomSheetContext).viewInsets.bottom + 16,
            ),
            child: const WatchlistSearchWidget(),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _bloc,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Market Data'),
          actions: [
            IconButton(
              icon: const Icon(Icons.search),
              onPressed: _showSearchBottomSheet,
              tooltip: 'Search assets',
            ),
          ],
        ),
        body: Column(
          children: [
            _buildConnectionBanner(),
            Expanded(child: _buildContent()),
          ],
        ),
      ),
    );
  }

  /// Renders the [ConnectionBannerWidget] when connection is not active.
  Widget _buildConnectionBanner() {
    return BlocBuilder<MarketDataDashboardBloc, MarketDataDashboardState>(
      buildWhen: (previous, current) {
        // Only rebuild when connection-related fields change.
        if (current is DashboardLoaded && previous is DashboardLoaded) {
          return current.connectionStatus != previous.connectionStatus ||
              current.reconnectAttempt != previous.reconnectAttempt ||
              current.lastDataReceived != previous.lastDataReceived;
        }
        return true;
      },
      builder: (context, state) {
        if (state is DashboardLoaded) {
          return ConnectionBannerWidget(
            connectionStatus: state.connectionStatus,
            reconnectAttempt: state.reconnectAttempt,
            lastDataReceived: state.lastDataReceived,
            onRetry: () => _bloc.add(const ManualRetryRequested()),
          );
        }
        return const SizedBox.shrink();
      },
    );
  }

  /// Builds the main content area based on the current BLoC state.
  Widget _buildContent() {
    return BlocBuilder<MarketDataDashboardBloc, MarketDataDashboardState>(
      builder: (context, state) {
        return switch (state) {
          DashboardLoading() => _buildLoadingState(),
          DashboardEmpty() => _buildEmptyState(),
          DashboardLoaded() => _buildLoadedState(state),
          DashboardError(:final message) => _buildErrorState(message),
        };
      },
    );
  }

  /// Shows a centered loading indicator.
  Widget _buildLoadingState() {
    return const Center(child: CircularProgressIndicator());
  }

  /// Shows an empty state prompt with a button to add assets.
  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.trending_up,
              size: 64,
              color: Theme.of(context)
                  .colorScheme
                  .onSurface
                  .withValues(alpha: 0.4),
            ),
            const SizedBox(height: 16),
            Text(
              'Add assets to start tracking',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _showSearchBottomSheet,
              icon: const Icon(Icons.add),
              label: const Text('Search Assets'),
            ),
          ],
        ),
      ),
    );
  }

  /// Renders the list of [PriceTickerWidget] items with swipe-to-remove.
  Widget _buildLoadedState(DashboardLoaded state) {
    final symbols = [
      ...state.prices.keys,
      ...state.unavailable,
    ];

    if (symbols.isEmpty) {
      return _buildEmptyState();
    }

    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      itemCount: symbols.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final symbol = symbols.elementAt(index);
        final price = state.prices[symbol];
        final isStale = state.stalePrices.contains(symbol);
        final isUnavailable = state.unavailable.contains(symbol);

        return Dismissible(
          key: ValueKey(symbol),
          direction: DismissDirection.endToStart,
          onDismissed: (_) {
            _bloc.add(RemoveFromWatchlist(symbol));
          },
          background: Container(
            alignment: Alignment.centerRight,
            padding: const EdgeInsets.only(right: 20.0),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.error,
              borderRadius: BorderRadius.circular(12.0),
            ),
            child: const Icon(
              Icons.delete,
              color: Colors.white,
            ),
          ),
          child: PriceTickerWidget(
            price: price,
            isStale: isStale,
            isUnavailable: isUnavailable,
            onTap: price != null ? () => _navigateToAssetDetail(symbol) : null,
          ),
        );
      },
    );
  }

  /// Shows an error state with the error message.
  Widget _buildErrorState(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline,
              size: 64,
              color: Theme.of(context).colorScheme.error,
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
      ),
    );
  }

  /// Navigates to the asset detail view for the given [symbol].
  void _navigateToAssetDetail(String symbol) {
    // Use the existing navigation pattern — push to MarketDataScreen
    // or a dedicated detail screen. For now, use a named route if available,
    // or push a generic detail page.
    Navigator.of(context).pushNamed(
      '/asset-detail',
      arguments: symbol,
    );
  }
}
