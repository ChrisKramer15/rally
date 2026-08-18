import 'dart:async';

import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:rally/data/repositories/market_data_repository.dart';
import 'package:rally/domain/models/asset_price.dart';
import 'package:rally/domain/models/asset_search_result.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/models/price_update.dart';
import 'package:rally/presentation/blocs/market_data_bloc.dart';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockMarketDataRepository extends Mock implements MarketDataRepository {}

void main() {
  late MockMarketDataRepository mockRepository;
  late StreamController<ConnectionStatus> connectionController;
  late StreamController<PriceUpdate> priceController;

  setUp(() {
    mockRepository = MockMarketDataRepository();
    connectionController = StreamController<ConnectionStatus>.broadcast();
    priceController = StreamController<PriceUpdate>.broadcast();

    when(() => mockRepository.connectionStatus)
        .thenAnswer((_) => connectionController.stream);
    when(() => mockRepository.priceStream)
        .thenAnswer((_) => priceController.stream);
  });

  tearDown(() {
    connectionController.close();
    priceController.close();
  });

  MarketDataBloc buildBloc() =>
      MarketDataBloc(repository: mockRepository);

  group('MarketDataBloc', () {
    test('initial state is MarketDataInitial', () {
      final bloc = buildBloc();
      expect(bloc.state, const MarketDataInitial());
      bloc.close();
    });

    // -----------------------------------------------------------------------
    // SearchAsset
    // -----------------------------------------------------------------------

    group('SearchAsset', () {
      final searchResults = [
        const AssetSearchResult(
          symbol: 'AAPL',
          name: 'Apple Inc.',
          currentPrice: 150.0,
          percentageChange: 1.5,
          type: AssetType.stock,
        ),
      ];

      blocTest<MarketDataBloc, MarketDataState>(
        'does nothing when query is empty',
        build: buildBloc,
        act: (bloc) => bloc.add(const SearchAsset('')),
        expect: () => <MarketDataState>[],
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'emits [Searching, SearchResults] when results are found',
        build: buildBloc,
        setUp: () {
          when(() => mockRepository.searchAssets('AAPL'))
              .thenAnswer((_) async => searchResults);
        },
        act: (bloc) => bloc.add(const SearchAsset('AAPL')),
        expect: () => [
          const Searching(),
          SearchResults(searchResults),
        ],
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'emits [Searching, NoResults] when search returns empty list',
        build: buildBloc,
        setUp: () {
          when(() => mockRepository.searchAssets('XYZ'))
              .thenAnswer((_) async => []);
        },
        act: (bloc) => bloc.add(const SearchAsset('XYZ')),
        expect: () => [
          const Searching(),
          const NoResults(),
        ],
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'emits [Searching, MarketDataError] on exception',
        build: buildBloc,
        setUp: () {
          when(() => mockRepository.searchAssets('ERR'))
              .thenThrow(Exception('Network error'));
        },
        act: (bloc) => bloc.add(const SearchAsset('ERR')),
        expect: () => [
          const Searching(),
          isA<MarketDataError>(),
        ],
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'does not search when query has less than 1 character (enforcing minimum)',
        build: buildBloc,
        act: (bloc) => bloc.add(const SearchAsset('')),
        verify: (_) {
          verifyNever(() => mockRepository.searchAssets(any()));
        },
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'searches when query has exactly 1 character',
        build: buildBloc,
        setUp: () {
          when(() => mockRepository.searchAssets('A'))
              .thenAnswer((_) async => searchResults);
        },
        act: (bloc) => bloc.add(const SearchAsset('A')),
        expect: () => [
          const Searching(),
          SearchResults(searchResults),
        ],
      );
    });

    // -----------------------------------------------------------------------
    // SelectAsset
    // -----------------------------------------------------------------------

    group('SelectAsset', () {
      final assetPrice = AssetPrice(
        symbol: 'AAPL',
        price: 150.0,
        dailyHigh: 155.0,
        dailyLow: 148.0,
        volume: 1000000,
        percentageChange: 1.5,
        timestamp: DateTime(2024, 1, 1),
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'emits [AssetDetail] when price is fetched successfully',
        build: buildBloc,
        setUp: () {
          when(() => mockRepository.getPrice('AAPL'))
              .thenAnswer((_) async => assetPrice);
        },
        act: (bloc) => bloc.add(const SelectAsset('AAPL')),
        expect: () => [AssetDetail(assetPrice)],
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'emits [MarketDataError] on exception',
        build: buildBloc,
        setUp: () {
          when(() => mockRepository.getPrice('ERR'))
              .thenThrow(Exception('Not found'));
        },
        act: (bloc) => bloc.add(const SelectAsset('ERR')),
        expect: () => [isA<MarketDataError>()],
      );
    });

    // -----------------------------------------------------------------------
    // SubscribeSymbols
    // -----------------------------------------------------------------------

    group('SubscribeSymbols', () {
      blocTest<MarketDataBloc, MarketDataState>(
        'calls repository subscribe and startPolling with symbols',
        build: buildBloc,
        setUp: () {
          when(() => mockRepository.subscribe(any())).thenReturn(null);
          when(() => mockRepository.startPolling(any())).thenReturn(null);
        },
        act: (bloc) => bloc.add(const SubscribeSymbols({'AAPL', 'GOOG'})),
        verify: (_) {
          verify(() => mockRepository.subscribe({'AAPL', 'GOOG'})).called(1);
          verify(() => mockRepository.startPolling({'AAPL', 'GOOG'})).called(1);
        },
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'does not emit new state on subscribe',
        build: buildBloc,
        setUp: () {
          when(() => mockRepository.subscribe(any())).thenReturn(null);
          when(() => mockRepository.startPolling(any())).thenReturn(null);
        },
        act: (bloc) => bloc.add(const SubscribeSymbols({'AAPL'})),
        expect: () => <MarketDataState>[],
      );
    });

    // -----------------------------------------------------------------------
    // ConnectionStatusChanged
    // -----------------------------------------------------------------------

    group('ConnectionStatusChanged', () {
      blocTest<MarketDataBloc, MarketDataState>(
        'emits ConnectionWarning when disconnected',
        build: buildBloc,
        act: (bloc) =>
            bloc.add(const ConnectionStatusChanged(ConnectionStatus.disconnected)),
        expect: () => [isA<ConnectionWarning>()],
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'emits ConnectionWarning when reconnecting',
        build: buildBloc,
        act: (bloc) =>
            bloc.add(const ConnectionStatusChanged(ConnectionStatus.reconnecting)),
        expect: () => [isA<ConnectionWarning>()],
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'does not emit ConnectionWarning when connected',
        build: buildBloc,
        act: (bloc) =>
            bloc.add(const ConnectionStatusChanged(ConnectionStatus.connected)),
        expect: () => <MarketDataState>[],
      );
    });

    // -----------------------------------------------------------------------
    // Connection status stream subscription
    // -----------------------------------------------------------------------

    group('connection status stream', () {
      blocTest<MarketDataBloc, MarketDataState>(
        'listens to connectionStatus stream and emits ConnectionWarning on disconnect',
        build: buildBloc,
        act: (bloc) {
          connectionController.add(ConnectionStatus.disconnected);
        },
        wait: const Duration(milliseconds: 50),
        expect: () => [isA<ConnectionWarning>()],
      );
    });

    // -----------------------------------------------------------------------
    // Price stream subscription
    // -----------------------------------------------------------------------

    group('price stream', () {
      final assetPrice = AssetPrice(
        symbol: 'AAPL',
        price: 150.0,
        dailyHigh: 155.0,
        dailyLow: 148.0,
        volume: 1000000,
        percentageChange: 1.5,
        timestamp: DateTime(2024, 1, 1),
      );

      final priceUpdate = PriceUpdate(
        symbol: 'AAPL',
        price: 152.0,
        dailyHigh: 156.0,
        dailyLow: 149.0,
        volume: 1100000,
        percentageChange: 2.0,
        timestamp: DateTime(2024, 1, 1, 0, 1),
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'updates AssetDetail when priceStream emits for current symbol',
        build: buildBloc,
        seed: () => AssetDetail(assetPrice),
        act: (bloc) {
          priceController.add(priceUpdate);
        },
        wait: const Duration(milliseconds: 50),
        expect: () => [
          AssetDetail(AssetPrice(
            symbol: 'AAPL',
            price: 152.0,
            dailyHigh: 156.0,
            dailyLow: 149.0,
            volume: 1100000,
            percentageChange: 2.0,
            timestamp: DateTime(2024, 1, 1, 0, 1),
          )),
        ],
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'ignores priceStream update for a different symbol',
        build: buildBloc,
        seed: () => AssetDetail(assetPrice),
        act: (bloc) {
          priceController.add(PriceUpdate(
            symbol: 'GOOG',
            price: 2800.0,
            dailyHigh: 2850.0,
            dailyLow: 2750.0,
            volume: 500000,
            percentageChange: 0.5,
            timestamp: DateTime(2024, 1, 1),
          ));
        },
        wait: const Duration(milliseconds: 50),
        expect: () => <MarketDataState>[],
      );

      blocTest<MarketDataBloc, MarketDataState>(
        'ignores priceStream update when not in AssetDetail state',
        build: buildBloc,
        act: (bloc) {
          priceController.add(priceUpdate);
        },
        wait: const Duration(milliseconds: 50),
        expect: () => <MarketDataState>[],
      );
    });
  });
}
