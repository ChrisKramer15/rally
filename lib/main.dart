import 'package:flutter/material.dart' as flutter show ThemeMode;
import 'package:flutter/material.dart' hide ThemeMode;
import 'package:flutter_bloc/flutter_bloc.dart';

import 'data/repositories/market_data_repository.dart';
import 'data/repositories/portfolio_repository.dart';
import 'data/services/theme_manager.dart';
import 'di/service_locator.dart';
import 'domain/models/enums.dart' as domain show ThemeMode;
import 'domain/services/i_market_data_service.dart';
import 'domain/services/i_portfolio_tracker.dart';
import 'presentation/blocs/chart_bloc.dart';
import 'presentation/blocs/market_data_bloc.dart';
import 'presentation/blocs/portfolio_bloc.dart';
import 'presentation/blocs/theme_cubit.dart';
import 'presentation/blocs/valuations_bloc.dart';
import 'presentation/screens/chart_screen.dart';
import 'presentation/screens/market_data_dashboard_screen.dart';
import 'presentation/screens/market_data_screen.dart';
import 'presentation/screens/portfolio_screen.dart';
import 'presentation/screens/recommendations_screen.dart';
import 'presentation/theme/neon_theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Set up dependency injection
  await configureDependencies();

  // Load persisted theme
  final themeManager = sl<ThemeManager>();
  await themeManager.loadPersistedTheme();

  // Load persisted portfolio data into the tracker
  final portfolioRepository = sl<PortfolioRepository>();
  final portfolioTracker = sl<IPortfolioTracker>();
  final savedHoldings = await portfolioRepository.loadHoldings();
  for (final holding in savedHoldings) {
    portfolioTracker.addHolding(
      symbol: holding.symbol,
      quantity: holding.quantity,
      averagePurchasePrice: holding.averagePurchasePrice,
    );
  }

  // Initialize WebSocket connection for real-time price streaming.
  // Subscribe to portfolio symbols so prices start flowing immediately.
  final marketDataService = sl<IMarketDataService>();
  final portfolioSymbols =
      portfolioTracker.getHoldings().map((h) => h.symbol).toSet();
  if (portfolioSymbols.isNotEmpty) {
    marketDataService.subscribe(portfolioSymbols);
  }

  // Start polling for portfolio price updates
  final marketDataRepository = sl<MarketDataRepository>();
  if (portfolioSymbols.isNotEmpty) {
    marketDataRepository.startPolling(portfolioSymbols);
  }

  runApp(const RallyApp());
}

/// Root widget for the Rally stock trading app.
///
/// Provides all BLoCs via [MultiBlocProvider] at the top of the widget tree
/// so that all screens reactively respond to state changes.
class RallyApp extends StatelessWidget {
  const RallyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider<ThemeCubit>(
          create: (_) => sl<ThemeCubit>(),
        ),
        BlocProvider<PortfolioBloc>(
          create: (_) => sl<PortfolioBloc>()..add(const LoadPortfolio()),
        ),
        BlocProvider<MarketDataBloc>(
          create: (_) => sl<MarketDataBloc>(),
        ),
        BlocProvider<ValuationsBloc>(
          create: (_) => sl<ValuationsBloc>(),
        ),
        BlocProvider<ChartBloc>(
          create: (_) => sl<ChartBloc>(),
        ),
      ],
      child: BlocBuilder<ThemeCubit, ThemeState>(
        builder: (context, themeState) {
          return MaterialApp(
            title: 'Rally',
            theme: NeonTheme.lightTheme,
            darkTheme: NeonTheme.darkTheme,
            themeMode: themeState.themeMode == domain.ThemeMode.dark
                ? flutter.ThemeMode.dark
                : flutter.ThemeMode.light,
            home: const RallyHomePage(),
            onGenerateRoute: (settings) {
              switch (settings.name) {
                case '/market-data-dashboard':
                  return MaterialPageRoute(
                    builder: (_) => const MarketDataDashboardScreen(),
                    settings: settings,
                  );
                case '/asset-detail':
                  // Navigate to the market data screen for asset detail.
                  // The symbol is passed as arguments for future use.
                  return MaterialPageRoute(
                    builder: (_) => const MarketDataScreen(),
                    settings: settings,
                  );
                default:
                  return null;
              }
            },
          );
        },
      ),
    );
  }
}

/// Main app shell with BottomNavigationBar for navigating between screens.
class RallyHomePage extends StatefulWidget {
  const RallyHomePage({super.key});

  @override
  State<RallyHomePage> createState() => _RallyHomePageState();
}

class _RallyHomePageState extends State<RallyHomePage> {
  int _currentIndex = 0;

  static const List<Widget> _screens = [
    PortfolioScreen(),
    MarketDataDashboardScreen(),
    MarketDataScreen(),
    RecommendationsScreen(),
    ChartScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        type: BottomNavigationBarType.fixed,
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.account_balance_wallet),
            label: 'Portfolio',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.show_chart),
            label: 'Watchlist',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.trending_up),
            label: 'Market',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.recommend),
            label: 'Trades',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.candlestick_chart),
            label: 'Chart',
          ),
        ],
      ),
    );
  }
}
