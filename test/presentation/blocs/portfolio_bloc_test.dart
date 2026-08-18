import 'dart:async';

import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:rally/data/repositories/market_data_repository.dart';
import 'package:rally/domain/models/holding.dart';
import 'package:rally/domain/models/portfolio_summary.dart';
import 'package:rally/domain/models/price_update.dart';
import 'package:rally/domain/models/result.dart';
import 'package:rally/domain/services/i_portfolio_tracker.dart';
import 'package:rally/presentation/blocs/portfolio_bloc.dart';

// --- Mocks ---

class MockPortfolioTracker extends Mock implements IPortfolioTracker {}

class MockMarketDataRepository extends Mock implements MarketDataRepository {}

void main() {
  late MockPortfolioTracker mockTracker;
  late MockMarketDataRepository mockRepo;
  late StreamController<PriceUpdate> priceStreamController;

  setUp(() {
    mockTracker = MockPortfolioTracker();
    mockRepo = MockMarketDataRepository();
    priceStreamController = StreamController<PriceUpdate>.broadcast();

    when(() => mockRepo.priceStream)
        .thenAnswer((_) => priceStreamController.stream);
  });

  tearDown(() {
    priceStreamController.close();
  });

  PortfolioBloc buildBloc() => PortfolioBloc(
        tracker: mockTracker,
        marketDataRepository: mockRepo,
      );

  group('PortfolioBloc', () {
    group('LoadPortfolio', () {
      blocTest<PortfolioBloc, PortfolioState>(
        'emits [PortfolioLoading, PortfolioEmpty] when holdings are empty',
        build: () {
          when(() => mockTracker.getHoldings()).thenReturn([]);
          return buildBloc();
        },
        act: (bloc) => bloc.add(const LoadPortfolio()),
        expect: () => [
          const PortfolioLoading(),
          const PortfolioEmpty(),
        ],
      );

      blocTest<PortfolioBloc, PortfolioState>(
        'emits [PortfolioLoading, PortfolioLoaded] when holdings exist',
        build: () {
          final holdings = [
            const Holding(
              symbol: 'AAPL',
              quantity: 10,
              averagePurchasePrice: 150.00,
            ),
          ];
          final summary = const PortfolioSummary(
            holdings: [
              HoldingValuation(
                holding: Holding(
                  symbol: 'AAPL',
                  quantity: 10,
                  averagePurchasePrice: 150.00,
                ),
                totalValue: 0,
                unrealizedGainLoss: 0,
              ),
            ],
            totalValue: 0,
            totalGainLoss: 0,
          );
          when(() => mockTracker.getHoldings()).thenReturn(holdings);
          when(() => mockTracker.recalculate(any())).thenReturn(summary);
          return buildBloc();
        },
        act: (bloc) => bloc.add(const LoadPortfolio()),
        expect: () => [
          const PortfolioLoading(),
          isA<PortfolioLoaded>(),
        ],
      );
    });

    group('AddHolding', () {
      blocTest<PortfolioBloc, PortfolioState>(
        'emits PortfolioLoaded on successful add',
        build: () {
          final holding = const Holding(
            symbol: 'GOOG',
            quantity: 5,
            averagePurchasePrice: 2800.00,
          );
          when(() => mockTracker.addHolding(
                symbol: 'GOOG',
                quantity: 5,
                averagePurchasePrice: 2800.00,
              )).thenReturn(Success(holding));
          when(() => mockTracker.getHoldings()).thenReturn([holding]);
          when(() => mockTracker.recalculate(any())).thenReturn(
            const PortfolioSummary(
              holdings: [],
              totalValue: 14000.00,
              totalGainLoss: 0,
            ),
          );
          return buildBloc();
        },
        act: (bloc) => bloc.add(const AddHolding(
          symbol: 'GOOG',
          quantity: 5,
          price: 2800.00,
        )),
        expect: () => [isA<PortfolioLoaded>()],
      );

      blocTest<PortfolioBloc, PortfolioState>(
        'emits PortfolioError on validation failure',
        build: () {
          when(() => mockTracker.addHolding(
                symbol: '',
                quantity: 5,
                averagePurchasePrice: 100.00,
              )).thenReturn(const Failure('Invalid field: symbol'));
          return buildBloc();
        },
        act: (bloc) => bloc.add(const AddHolding(
          symbol: '',
          quantity: 5,
          price: 100.00,
        )),
        expect: () => [
          const PortfolioError(message: 'Invalid field: symbol'),
        ],
      );
    });

    group('RemoveHolding', () {
      blocTest<PortfolioBloc, PortfolioState>(
        'emits PortfolioLoaded after successful removal with remaining holdings',
        build: () {
          final remaining = [
            const Holding(
              symbol: 'GOOG',
              quantity: 5,
              averagePurchasePrice: 2800.00,
            ),
          ];
          when(() => mockTracker.removeHolding('AAPL'))
              .thenReturn(const Success(null));
          when(() => mockTracker.getHoldings()).thenReturn(remaining);
          when(() => mockTracker.recalculate(any())).thenReturn(
            const PortfolioSummary(
              holdings: [],
              totalValue: 14000.00,
              totalGainLoss: 0,
            ),
          );
          return buildBloc();
        },
        act: (bloc) => bloc.add(const RemoveHolding(symbol: 'AAPL')),
        expect: () => [isA<PortfolioLoaded>()],
      );

      blocTest<PortfolioBloc, PortfolioState>(
        'emits PortfolioEmpty after removing last holding',
        build: () {
          when(() => mockTracker.removeHolding('AAPL'))
              .thenReturn(const Success(null));
          when(() => mockTracker.getHoldings()).thenReturn([]);
          return buildBloc();
        },
        act: (bloc) => bloc.add(const RemoveHolding(symbol: 'AAPL')),
        expect: () => [const PortfolioEmpty()],
      );

      blocTest<PortfolioBloc, PortfolioState>(
        'emits PortfolioError when removal fails',
        build: () {
          when(() => mockTracker.removeHolding('XYZ'))
              .thenReturn(const Failure('Symbol XYZ not found'));
          return buildBloc();
        },
        act: (bloc) => bloc.add(const RemoveHolding(symbol: 'XYZ')),
        expect: () => [
          const PortfolioError(message: 'Symbol XYZ not found'),
        ],
      );
    });

    group('PriceUpdated', () {
      blocTest<PortfolioBloc, PortfolioState>(
        'emits PortfolioLoaded with recalculated values on price update',
        build: () {
          final holdings = [
            const Holding(
              symbol: 'AAPL',
              quantity: 10,
              averagePurchasePrice: 150.00,
            ),
          ];
          final summary = const PortfolioSummary(
            holdings: [
              HoldingValuation(
                holding: Holding(
                  symbol: 'AAPL',
                  quantity: 10,
                  averagePurchasePrice: 150.00,
                ),
                totalValue: 1600.00,
                unrealizedGainLoss: 100.00,
              ),
            ],
            totalValue: 1600.00,
            totalGainLoss: 100.00,
          );
          when(() => mockTracker.getHoldings()).thenReturn(holdings);
          when(() => mockTracker.recalculate({'AAPL': 160.00}))
              .thenReturn(summary);
          return buildBloc();
        },
        act: (bloc) => bloc.add(const PriceUpdated(
          prices: {'AAPL': 160.00},
        )),
        expect: () => [isA<PortfolioLoaded>()],
      );

      blocTest<PortfolioBloc, PortfolioState>(
        'does not emit new state when portfolio is empty on price update',
        build: () {
          when(() => mockTracker.getHoldings()).thenReturn([]);
          return buildBloc();
        },
        act: (bloc) => bloc.add(const PriceUpdated(
          prices: {'AAPL': 160.00},
        )),
        expect: () => [],
      );
    });

    group('price stream subscription', () {
      test('dispatches PriceUpdated when price stream emits', () async {
        final holdings = [
          const Holding(
            symbol: 'AAPL',
            quantity: 10,
            averagePurchasePrice: 150.00,
          ),
        ];
        final summary = const PortfolioSummary(
          holdings: [
            HoldingValuation(
              holding: Holding(
                symbol: 'AAPL',
                quantity: 10,
                averagePurchasePrice: 150.00,
              ),
              totalValue: 1550.00,
              unrealizedGainLoss: 50.00,
            ),
          ],
          totalValue: 1550.00,
          totalGainLoss: 50.00,
        );
        when(() => mockTracker.getHoldings()).thenReturn(holdings);
        when(() => mockTracker.recalculate(any())).thenReturn(summary);

        final bloc = buildBloc();

        // Emit a price update through the stream.
        priceStreamController.add(PriceUpdate(
          symbol: 'AAPL',
          price: 155.00,
          dailyHigh: 160.00,
          dailyLow: 148.00,
          volume: 1000000,
          percentageChange: 3.33,
          timestamp: DateTime.now(),
        ));

        // Allow the stream event to propagate.
        await Future<void>.delayed(const Duration(milliseconds: 50));

        expect(bloc.state, isA<PortfolioLoaded>());

        await bloc.close();
      });
    });
  });
}
