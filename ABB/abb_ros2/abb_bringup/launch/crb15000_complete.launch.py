from launch_ros.substitutions import FindPackageShare
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription, DeclareLaunchArgument
from launch.conditions import IfCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution

def generate_launch_description():
    use_fake_hardware = LaunchConfiguration('use_fake_hardware')
    launch_rviz = LaunchConfiguration('launch_rviz')
    rws_ip = LaunchConfiguration('rws_ip')
    rws_port = LaunchConfiguration('rws_port')

    ### MoveIt move_group ###
    move_group = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            [PathJoinSubstitution([FindPackageShare('abb_crb15000_moveit'), 'launch', 'move_group.launch.py'])]
        )
    )

    ### MoveIt RViz ###
    moveit_rviz = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            [PathJoinSubstitution([FindPackageShare('abb_crb15000_moveit'), 'launch', 'moveit_rviz.launch.py'])]
        ),
        condition=IfCondition(launch_rviz),
        launch_arguments={
            'publish_robot_description_semantic': 'true',
        }.items()
    )
    
    ### ABB Robot Driver ###
    driver = IncludeLaunchDescription(
    PythonLaunchDescriptionSource([PathJoinSubstitution([FindPackageShare('abb_bringup'), 'launch', 'abb_control.launch.py'])]),
    launch_arguments={
        'description_package': 'abb_crb15000_support',
        'description_file': 'crb15000_5_95.xacro',
        'moveit_config_package': 'abb_crb15000_moveit',
        'launch_rviz': 'false',
        'use_fake_hardware': use_fake_hardware,
        'rws_ip': rws_ip,
        'rws_port': rws_port
    }.items()
)
    
    return LaunchDescription([
        DeclareLaunchArgument('use_fake_hardware', default_value='false'),
        DeclareLaunchArgument('launch_rviz', default_value='true'),
        DeclareLaunchArgument('rws_ip', default_value='192.168.125.1'),
        DeclareLaunchArgument('rws_port', default_value='443'),
        driver,
        move_group,
        moveit_rviz,
    ])
