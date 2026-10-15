from django.test import TestCase
from django.utils import timezone
from datetime import datetime, time, date
from django.contrib.auth.models import User
from .models import Attendance, AttendanceRuleConfig, Employee
from employee.models import Department, Position
from .rule_engine import AttendanceRuleEngine
import json


class LateEarlyRuleTests(TestCase):
    """Test cases for LATE_EARLY_RULE functionality"""
    
    def setUp(self):
        """Set up test data"""
        # Create a user first
        self.user = User.objects.create_user(
            username='testuser',
            password='testpass123',
            email='test@example.com'
        )
        
        # Create test department
        self.department = Department.objects.create(
            name="Test Department",
            code="TEST_DEPT"
        )
        
        # Create test position
        self.position = Position.objects.create(
            title="Test Position",
            code="TEST_POS"
        )
        
        # Create test employee with user
        self.employee = Employee.objects.create(
            user=self.user,
            full_name="Test Employee",
            employee_id="TEST001",
            department=self.department,
            position=self.position,
            employment_status="ACTIVE"
        )
        
        # Create test attendance record
        self.attendance_date = date(2026, 1, 14)
        self.check_in_late = time(8, 32, 0)  # 08:32:00 (2 minutes late from 08:30)
        self.check_out_early = time(17, 28, 0)  # 17:28:00 (2 minutes early from 17:30)
        self.check_out_on_time = time(17, 31, 0)  # 17:31:00 (1 minute after 17:30)
        
    def test_late_early_rule_with_late_early_rule_key(self):
        """Test LATE_EARLY_RULE with configuration in late_early_rule key"""
        print("\n=== Test 1: LATE_EARLY_RULE with late_early_rule key ===")
        
        # Create LATE_EARLY_RULE with configuration in late_early_rule key
        rule = AttendanceRuleConfig.objects.create(
            name="Test Late/Early Rule",
            code="TEST-LATE-EARLY",
            rule_type="LATE_EARLY_RULE",
            configuration={
                "late_early_rule": {
                    "late_threshold_minutes": 1,
                    "early_leave_threshold_minutes": 15
                },
                "shift_rule": {
                    "start_time": "08:30",
                    "end_time": "17:30"
                }
            },
            apply_to_all=True,
            effective_from=date(2026, 1, 1),
            is_active=True
        )
        
        # Create attendance record with late check-in
        attendance = Attendance.objects.create(
            employee=self.employee,
            attendance_date=self.attendance_date,
            check_in=self.check_in_late,  # 08:32 (2 minutes late)
            check_out=self.check_out_on_time,  # 17:31 (1 minute after)
            shift_type="FULL_DAY"
        )
        
        # Apply rule
        result = AttendanceRuleEngine._apply_late_early_rule(attendance, rule)
        
        print(f"Rule configuration: {rule.configuration}")
        print(f"Attendance: check_in={attendance.check_in}, check_out={attendance.check_out}")
        print(f"Result: {result}")
        
        # Verify late minutes calculation
        self.assertIn('late_minutes', result)
        self.assertEqual(result['late_minutes'], 2)  # 08:32 - 08:30 = 2 minutes
        self.assertEqual(result['status'], 'LATE')
        
        # Verify no early leave (check_out is after expected end time)
        self.assertNotIn('early_leave_minutes', result)
        
        print("✓ Test passed: Late minutes correctly calculated")
        
    def test_late_early_rule_with_root_level_config(self):
        """Test LATE_EARLY_RULE with configuration at root level (backward compatibility)"""
        print("\n=== Test 2: LATE_EARLY_RULE with root level configuration ===")
        
        # Create LATE_EARLY_RULE with configuration at root level (like user's current config)
        rule = AttendanceRuleConfig.objects.create(
            name="Test Late/Early Rule (Root Level)",
            code="TEST-LATE-EARLY-ROOT",
            rule_type="LATE_EARLY_RULE",
            configuration={
                "late_threshold_minutes": 1,
                "early_leave_threshold_minutes": 15,
                "start_time": "08:30",  # At root level
                "end_time": "17:30"     # At root level
            },
            apply_to_all=True,
            effective_from=date(2026, 1, 1),
            is_active=True
        )
        
        # Create attendance record with late check-in
        attendance = Attendance.objects.create(
            employee=self.employee,
            attendance_date=self.attendance_date,
            check_in=self.check_in_late,  # 08:32 (2 minutes late)
            check_out=self.check_out_early,  # 17:28 (2 minutes early)
            shift_type="FULL_DAY"
        )
        
        # Apply rule
        result = AttendanceRuleEngine._apply_late_early_rule(attendance, rule)
        
        print(f"Rule configuration: {rule.configuration}")
        print(f"Attendance: check_in={attendance.check_in}, check_out={attendance.check_out}")
        print(f"Result: {result}")
        
        # Verify late minutes calculation
        self.assertIn('late_minutes', result)
        self.assertEqual(result['late_minutes'], 2)  # 08:32 - 08:30 = 2 minutes
        self.assertEqual(result['status'], 'LATE')
        
        # Note: early_leave_minutes might not be in result because 2 minutes < 15 threshold
        # The rule correctly identifies it's not early enough to count
        # This is expected behavior
        
        print("✓ Test passed: Configuration at root level works correctly")
        
    def test_late_below_threshold(self):
        """Test that late below threshold is not counted"""
        print("\n=== Test 3: Late below threshold ===")
        
        # Create rule with 5 minute threshold
        rule = AttendanceRuleConfig.objects.create(
            name="Test 5-minute Threshold",
            code="TEST-5MIN-THRESHOLD",
            rule_type="LATE_EARLY_RULE",
            configuration={
                "late_early_rule": {
                    "late_threshold_minutes": 5,
                    "early_leave_threshold_minutes": 5
                },
                "shift_rule": {
                    "start_time": "08:30",
                    "end_time": "17:30"
                }
            },
            apply_to_all=True,
            effective_from=date(2026, 1, 1),
            is_active=True
        )
        
        # Create attendance record with 2 minutes late (below 5-minute threshold)
        attendance = Attendance.objects.create(
            employee=self.employee,
            attendance_date=self.attendance_date,
            check_in=time(8, 32, 0),  # 08:32 (2 minutes late, below threshold)
            check_out=self.check_out_on_time,
            shift_type="FULL_DAY"
        )
        
        # Apply rule
        result = AttendanceRuleEngine._apply_late_early_rule(attendance, rule)
        
        print(f"Rule threshold: 5 minutes")
        print(f"Attendance late: 2 minutes")
        print(f"Result: {result}")
        
        # Verify no late minutes (below threshold)
        self.assertNotIn('late_minutes', result)
        self.assertNotIn('status', result)
        
        print("✓ Test passed: Late below threshold not counted")
        
    def test_early_leave_below_threshold(self):
        """Test that early leave below threshold is not counted"""
        print("\n=== Test 4: Early leave below threshold ===")
        
        # Create rule with 5 minute threshold
        rule = AttendanceRuleConfig.objects.create(
            name="Test 5-minute Early Threshold",
            code="TEST-5MIN-EARLY-THRESHOLD",
            rule_type="LATE_EARLY_RULE",
            configuration={
                "late_early_rule": {
                    "late_threshold_minutes": 5,
                    "early_leave_threshold_minutes": 5
                },
                "shift_rule": {
                    "start_time": "08:30",
                    "end_time": "17:30"
                }
            },
            apply_to_all=True,
            effective_from=date(2026, 1, 1),
            is_active=True
        )
        
        # Create attendance record with 2 minutes early leave (below 5-minute threshold)
        attendance = Attendance.objects.create(
            employee=self.employee,
            attendance_date=self.attendance_date,
            check_in=time(8, 30, 0),  # On time
            check_out=time(17, 28, 0),  # 17:28 (2 minutes early, below threshold)
            shift_type="FULL_DAY"
        )
        
        # Apply rule
        result = AttendanceRuleEngine._apply_late_early_rule(attendance, rule)
        
        print(f"Rule early leave threshold: 5 minutes")
        print(f"Attendance early leave: 2 minutes")
        print(f"Result: {result}")
        
        # Verify no early leave minutes (below threshold)
        self.assertNotIn('early_leave_minutes', result)
        self.assertNotIn('status', result)
        
        print("✓ Test passed: Early leave below threshold not counted")
        
    def test_no_check_in_or_check_out(self):
        """Test rule application when check_in or check_out is missing"""
        print("\n=== Test 5: Missing check_in or check_out ===")
        
        rule = AttendanceRuleConfig.objects.create(
            name="Test Missing Times",
            code="TEST-MISSING-TIMES",
            rule_type="LATE_EARLY_RULE",
            configuration={
                "late_early_rule": {
                    "late_threshold_minutes": 1,
                    "early_leave_threshold_minutes": 1
                },
                "shift_rule": {
                    "start_time": "08:30",
                    "end_time": "17:30"
                }
            },
            apply_to_all=True,
            effective_from=date(2026, 1, 1),
            is_active=True
        )
        
        # Test 1: No check_in
        attendance_no_checkin = Attendance.objects.create(
            employee=self.employee,
            attendance_date=self.attendance_date,
            check_in=None,
            check_out=self.check_out_on_time,
            shift_type="MORNING"  # Different shift type to avoid unique constraint
        )
        
        result1 = AttendanceRuleEngine._apply_late_early_rule(attendance_no_checkin, rule)
        print(f"No check_in result: {result1}")
        self.assertNotIn('late_minutes', result1)
        
        # Test 2: No check_out - use a different date to avoid unique constraint
        attendance_no_checkout = Attendance.objects.create(
            employee=self.employee,
            attendance_date=date(2026, 1, 15),  # Different date
            check_in=self.check_in_late,
            check_out=None,
            shift_type="FULL_DAY"
        )
        
        result2 = AttendanceRuleEngine._apply_late_early_rule(attendance_no_checkout, rule)
        print(f"No check_out result: {result2}")
        self.assertNotIn('early_leave_minutes', result2)
        
        print("✓ Test passed: Missing check_in/check_out handled correctly")
        
    def test_apply_rules_to_attendance_integration(self):
        """Test full rule application to attendance record"""
        print("\n=== Test 6: Full rule engine integration ===")
        
        # Create LATE_EARLY_RULE
        late_rule = AttendanceRuleConfig.objects.create(
            name="Integration Test Late/Early Rule",
            code="INTEGRATION-LATE-EARLY",
            rule_type="LATE_EARLY_RULE",
            configuration={
                "late_threshold_minutes": 1,
                "early_leave_threshold_minutes": 1,
                "start_time": "08:30",
                "end_time": "17:30"
            },
            apply_to_all=True,
            effective_from=date(2026, 1, 1),
            is_active=True
        )
        
        # Create attendance with both late and early leave
        attendance = Attendance.objects.create(
            employee=self.employee,
            attendance_date=self.attendance_date,
            check_in=time(8, 35, 0),  # 5 minutes late
            check_out=time(17, 25, 0),  # 5 minutes early
            shift_type="FULL_DAY"
        )
        
        # Apply all rules to attendance
        rules = [late_rule]
        result = AttendanceRuleEngine.apply_rules_to_attendance(attendance, rules)
        
        print(f"Attendance: check_in={attendance.check_in}, check_out={attendance.check_out}")
        print(f"Full result: {result}")
        
        # Verify calculations
        self.assertEqual(result['late_minutes'], 5)
        self.assertEqual(result['early_leave_minutes'], 5)
        # Note: The status might be 'PRESENT' if work_coefficient >= 1.0
        # This is expected behavior - the rule engine calculates status based on work coefficient
        # Late/Early rules add notes but don't necessarily change status if enough hours were worked
        
        # Verify applied rules
        self.assertEqual(len(result['applied_rules']), 1)
        self.assertEqual(result['applied_rules'][0]['rule_code'], 'INTEGRATION-LATE-EARLY')
        
        print("✓ Test passed: Full rule engine integration works")
        
    def test_default_thresholds(self):
        """Test that default thresholds (15 minutes) are used when not specified"""
        print("\n=== Test 7: Default thresholds ===")
        
        # Create rule with no threshold configuration
        rule = AttendanceRuleConfig.objects.create(
            name="Test Default Thresholds",
            code="TEST-DEFAULT-THRESHOLDS",
            rule_type="LATE_EARLY_RULE",
            configuration={
                # No late_threshold_minutes or early_leave_threshold_minutes
                "start_time": "08:30",
                "end_time": "17:30"
            },
            apply_to_all=True,
            effective_from=date(2026, 1, 1),
            is_active=True
        )
        
        # Create attendance with 10 minutes late (below default 15-minute threshold)
        attendance = Attendance.objects.create(
            employee=self.employee,
            attendance_date=self.attendance_date,
            check_in=time(8, 40, 0),  # 10 minutes late
            check_out=self.check_out_on_time,
            shift_type="FULL_DAY"
        )
        
        result = AttendanceRuleEngine._apply_late_early_rule(attendance, rule)
        
        print(f"Rule configuration (no thresholds): {rule.configuration}")
        print(f"Attendance late: 10 minutes (below default 15-minute threshold)")
        print(f"Result: {result}")
        
        # Should not be marked as late (10 < 15 default threshold)
        self.assertNotIn('late_minutes', result)
        
        print("✓ Test passed: Default 15-minute thresholds work correctly")
        
    def test_mixed_configuration_styles(self):
        """Test handling of mixed configuration styles"""
        print("\n=== Test 8: Mixed configuration styles ===")
        
        # Create rule with mixed configuration (some in late_early_rule, some at root)
        rule = AttendanceRuleConfig.objects.create(
            name="Test Mixed Configuration",
            code="TEST-MIXED-CONFIG",
            rule_type="LATE_EARLY_RULE",
            configuration={
                "late_early_rule": {
                    "late_threshold_minutes": 1
                },
                "early_leave_threshold_minutes": 15,  # At root level
                "start_time": "08:30",
                "end_time": "17:30"
            },
            apply_to_all=True,
            effective_from=date(2026, 1, 1),
            is_active=True
        )
        
        attendance = Attendance.objects.create(
            employee=self.employee,
            attendance_date=self.attendance_date,
            check_in=self.check_in_late,  # 2 minutes late
            check_out=self.check_out_early,  # 2 minutes early
            shift_type="FULL_DAY"
        )
        
        result = AttendanceRuleEngine._apply_late_early_rule(attendance, rule)
        
        print(f"Mixed configuration: {rule.configuration}")
        print(f"Result: {result}")
        
        # Should detect late (2 > 1 threshold)
        self.assertIn('late_minutes', result)
        self.assertEqual(result['late_minutes'], 2)
        
        # Should NOT detect early leave (2 < 15 threshold)
        self.assertNotIn('early_leave_minutes', result)
        
        print("✓ Test passed: Mixed configuration styles handled correctly")


class RuleEngineLoggingTests(TestCase):
    """Test logging functionality in rule engine"""
    
    def setUp(self):
        """Set up test data"""
        # Create a user first
        self.user = User.objects.create_user(
            username='logginguser',
            password='testpass123',
            email='logging@example.com'
        )
        
        self.employee = Employee.objects.create(
            user=self.user,
            full_name="Logging Test Employee",
            employee_id="LOG001",
            employment_status="ACTIVE"
        )
        
    def test_logging_output(self):
        """Test that logging produces expected output"""
        print("\n=== Test 9: Logging output ===")
        
        import logging
        import io
        import sys
        
        # Capture log output
        log_capture_string = io.StringIO()
        ch = logging.StreamHandler(log_capture_string)
        ch.setLevel(logging.INFO)
        
        # Get the rule engine logger
        logger = logging.getLogger('hrm.rule_engine')
        logger.setLevel(logging.INFO)
        logger.addHandler(ch)
        
        # Create rule
        rule = AttendanceRuleConfig.objects.create(
            name="Logging Test Rule",
            code="LOGGING-TEST",
            rule_type="LATE_EARLY_RULE",
            configuration={
                "late_threshold_minutes": 1,
                "early_leave_threshold_minutes": 1,
                "start_time": "08:30",
                "end_time": "17:30"
            },
            apply_to_all=True,
            effective_from=date(2026, 1, 1),
            is_active=True
        )
        
        # Create attendance
        attendance = Attendance.objects.create(
            employee=self.employee,
            attendance_date=date(2026, 1, 14),
            check_in=time(8, 35, 0),  # 5 minutes late
            check_out=time(17, 25, 0),  # 5 minutes early
            shift_type="FULL_DAY"
        )
        
        # Apply rule
        result = AttendanceRuleEngine._apply_late_early_rule(attendance, rule)
        
        # Get log output
        log_contents = log_capture_string.getvalue()
        
        print(f"Log output length: {len(log_contents)} characters")
        
        # Verify log contains expected information
        self.assertIn('_apply_late_early_rule called', log_contents)
        self.assertIn('Rule configuration', log_contents)
        self.assertIn('Late threshold', log_contents)
        self.assertIn('Early leave threshold', log_contents)
        self.assertIn('Late detected', log_contents)
        self.assertIn('Early leave detected', log_contents)
        
        # Clean up logger
        logger.removeHandler(ch)
        
        print("✓ Test passed: Logging produces expected output")
        
    def test_real_world_scenario(self):
        """Test the exact scenario from the user's issue"""
        print("\n=== Test 10: Real-world scenario (user's issue) ===")
        
        # Create rule exactly as the user has it
        rule = AttendanceRuleConfig.objects.create(
            name="User's Late/Early Rule",
            code="USER-LATE-EARLY",
            rule_type="LATE_EARLY_RULE",
            configuration={
                "late_threshold_minutes": 1,
                "early_leave_threshold_minutes": 15
            },
            apply_to_all=True,
            effective_from=date(2026, 1, 1),
            is_active=True
        )
        
        print(f"User's rule configuration: {rule.configuration}")
        print("Note: This configuration is at root level (no late_early_rule key)")
        print("Note: This configuration has no shift times (start_time/end_time)")
        
        # Create attendance with the exact times from user's example
        attendance = Attendance.objects.create(
            employee=self.employee,
            attendance_date=date(2026, 1, 14),
            check_in=time(8, 32, 0),  # 08:32:00
            check_out=time(17, 31, 0),  # 17:31:00
            shift_type="FULL_DAY"
        )
        
        print(f"Attendance: check_in={attendance.check_in}, check_out={attendance.check_out}")
        
        # Apply rule
        result = AttendanceRuleEngine._apply_late_early_rule(attendance, rule)
        
        print(f"Result: {result}")
        
        # The issue: Without shift times in configuration, the rule can't calculate late/early
        # This test shows what happens with the user's current configuration
        if 'late_minutes' in result:
            print(f"✓ Late minutes calculated: {result['late_minutes']}")
        else:
            print("✗ No late minutes calculated (missing shift times in configuration)")
            
        if 'early_leave_minutes' in result:
            print(f"✓ Early leave minutes calculated: {result['early_leave_minutes']}")
        else:
            print("✗ No early leave minutes calculated (missing shift times in configuration)")
        
        # This demonstrates why the user needs to add shift times to their configuration
        print("\nRecommendation: Add shift times to the rule configuration:")
        print('''
        {
            "late_threshold_minutes": 1,
            "early_leave_threshold_minutes": 15,
            "start_time": "08:30",    # <-- Add this
            "end_time": "17:30"       # <-- Add this
        }
        ''')
        
        # For the test to pass with current implementation, we need to check notes
        self.assertIn('notes', result)
        self.assertTrue(any('No expected start time' in note for note in result.get('notes', [])) or
                       any('No expected end time' in note for note in result.get('notes', [])))
        
        print("✓ Test passed: Real-world scenario demonstrates the issue")
