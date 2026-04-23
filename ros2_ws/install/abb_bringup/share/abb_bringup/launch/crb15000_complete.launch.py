from launch_ros.substitutions import FindPackageShare
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription, DeclareLaunchArgument, LogInfo
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import PathJoinSubstitution, TextSubstitution

def generate_launch_description():
    ###Move Group MoveIt###
    move_group = IncludeLaunchDescription(PythonLaunchDescriptionSource([PathJoinSubstitution([FindPackageShare('abb_crb15000_moveit'), 'launch','move_group.launch.py'])])) 
    
    ###ABB Robot Driver###
    driver = IncludeLaunchDescription(
    PythonLaunchDescriptionSource([PathJoinSubstitution([FindPackageShare('abb_bringup'), 'launch', 'abb_control.launch.py'])]),
    launch_arguments={
        'description_package': 'abb_crb15000_support',
        'description_file': 'crb15000_5_95.xacro',
        'moveit_config_package': 'abb_crb15000_moveit',
        'launch_rviz': 'true',
        'use_fake_hardware': 'false',
        'rws_ip': '192.168.125.1',
        'rws_port': '443'    
    }.items()
)
    
    return LaunchDescription([driver,move_group])
