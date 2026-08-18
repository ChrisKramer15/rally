import 'package:get_it/get_it.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../data/repositories/market_data_repository.dart';
import '../data/repositories/portfolio_repository.dart';
import '../data/services/market_data_service.dart';
import '../data/services/theme_manager.dart';
import '../data/services/watchlist_store.dart';
import '../domain/services/i_market_data_service.dart';
import '../domain/services/i_portfolio_tracker.dart';
import '../domain/services/i_valuations_engine.dart';
import '../domain/services/i_watchlist_store.dart';
import '../domain/services/portfolio_tracker.dart';
import '../domain/services/valuations_engine.dart';
import '../presentation/blocs/chart_bloc.dart';
import '../presentation/blocs/market_data/market_data_dashboard_bloc.dart';
import '../presentation/blocs/market_data_bloc.dart';
import '../presentation/blocs/portfolio_bloc.dart';
import '../presentation/blocs/theme_cubit.dart';
import '../presentation/blocs/valuations_bloc.dart';

/// Global service locator instance.
final GetIt sl = GetIt.instance;

/// Sets up all dependency injection registrations.
///
/// Must be called before [runApp] in main.dart. Requires [SharedPreferences]
/// to be pre-initialized (since getInstance is async).
Future<void> configureDependencies() async {
  final sharedPreferences = await SharedPreferences.getInstance();

  // --- External dependencies ---
  sl.registerLazySingleton<SharedPreferences>(() => sharedPreferences);
  sl.registerLazySingleton<http.Client>(() => http.Client());

  // --- Data Layer: Services ---
  sl.registerLazySingleton<ThemeManager>(
    () => ThemeManager(sharedPreferences: sl<SharedPreferences>()),
  );

  sl.registerLazySingleton<IMarketDataService>(
    () => MarketDataService(
      baseUrl: const String.fromEnvironment(
        'MARKET_API_BASE_URL',
        defaultValue: 'https://api.rally.dev',
      ),
      webSocketUrl: const String.fromEnvironment(
        'MARKET_WS_URL',
        defaultValue: 'wss://ws.rally.dev/stream',
      ),
      httpClient: sl<http.Client>(),
    ),
  );

  // --- Data Layer: Repositories ---
  sl.registerLazySingleton<MarketDataRepository>(
    () => MarketDataRepository(service: sl<IMarketDataService>()),
  );

  sl.registerLazySingleton<PortfolioRepository>(
    () => PortfolioRepository(sharedPreferences: sl<SharedPreferences>()),
  );

  // --- Data Layer: Stores ---
  sl.registerLazySingleton<IWatchlistStore>(
    () => WatchlistStore(prefs: sl<SharedPreferences>()),
  );

  // --- Domain Layer: Services ---
  sl.registerLazySingleton<IPortfolioTracker>(
    () => PortfolioTracker(),
  );

  sl.registerLazySingleton<IValuationsEngine>(
    () => ValuationsEngine(),
  );

  // --- Presentation Layer: BLoCs (factory = new instance per request) ---
  sl.registerFactory<ThemeCubit>(
    () => ThemeCubit(themeManager: sl<ThemeManager>()),
  );

  sl.registerFactory<PortfolioBloc>(
    () => PortfolioBloc(
      tracker: sl<IPortfolioTracker>(),
      marketDataRepository: sl<MarketDataRepository>(),
    ),
  );

  sl.registerFactory<MarketDataBloc>(
    () => MarketDataBloc(repository: sl<MarketDataRepository>()),
  );

  sl.registerFactory<ValuationsBloc>(
    () => ValuationsBloc(
      engine: sl<IValuationsEngine>(),
      marketDataRepository: sl<MarketDataRepository>(),
    ),
  );

  sl.registerFactory<ChartBloc>(
    () => ChartBloc(repository: sl<MarketDataRepository>()),
  );

  sl.registerFactory<MarketDataDashboardBloc>(
    () => MarketDataDashboardBloc(
      watchlistStore: sl<IWatchlistStore>(),
      repository: sl<MarketDataRepository>(),
    ),
  );
}
