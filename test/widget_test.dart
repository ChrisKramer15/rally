import 'package:flutter_test/flutter_test.dart';
import 'package:rally/di/service_locator.dart';
import 'package:rally/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    // Set up fake SharedPreferences values for the test environment.
    SharedPreferences.setMockInitialValues({});
    await configureDependencies();
  });

  tearDownAll(() async {
    await sl.reset();
  });

  testWidgets('RallyApp renders without errors', (WidgetTester tester) async {
    await tester.pumpWidget(const RallyApp());
    await tester.pump();

    // The app should render with a bottom navigation bar
    expect(find.text('Portfolio'), findsWidgets);
    expect(find.text('Market'), findsOneWidget);
    expect(find.text('Trades'), findsOneWidget);
    expect(find.text('Chart'), findsWidgets);
  });
}
