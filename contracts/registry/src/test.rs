#![cfg(test)]
use super::{AuthoraRegistry, AuthoraRegistryClient, ServiceEntry};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn test_register_and_get() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AuthoraRegistry);
    let client = AuthoraRegistryClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let entry = ServiceEntry {
        url: String::from_str(&env, "https://api.example.com/v1"),
        name: String::from_str(&env, "Test Service"),
        description: String::from_str(&env, "This is a test service"),
        price_usdc: 10000, // 0.001 USDC
        input_schema: String::from_str(&env, "{}"),
        output_schema: String::from_str(&env, "{}"),
        owner: owner.clone(),
        verified: false,
        total_payments: 0,
    };

    client.register_service(&owner, &entry);
    
    assert_eq!(client.service_count(), 1);
    
    let fetched = client.get_service(&String::from_str(&env, "https://api.example.com/v1")).unwrap();
    assert_eq!(fetched.name, String::from_str(&env, "Test Service"));
    assert_eq!(fetched.owner, owner);
}

#[test]
fn test_list_and_pagination() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AuthoraRegistry);
    let client = AuthoraRegistryClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    
    for i in 0..10 {
        let entry = ServiceEntry {
            url: String::from_str(&env, &format!("https://service{}.local", i)),
            name: String::from_str(&env, &format!("Service {}", i)),
            description: String::from_str(&env, "Test service"),
            price_usdc: 1000,
            input_schema: String::from_str(&env, "{}"),
            output_schema: String::from_str(&env, "{}"),
            owner: owner.clone(),
            verified: false,
            total_payments: 0,
        };
        client.register_service(&owner, &entry);
    }

    assert_eq!(client.service_count(), 10);
    
    // First page
    let list1 = client.list_services(&0, &5);
    assert_eq!(list1.len(), 5);
    assert_eq!(list1.get(0).unwrap().name, String::from_str(&env, "Service 0"));
    
    // Second page
    let list2 = client.list_services(&5, &5);
    assert_eq!(list2.len(), 5);
    assert_eq!(list2.get(0).unwrap().name, String::from_str(&env, "Service 5"));
    
    // Overflow
    let list3 = client.list_services(&8, &5);
    assert_eq!(list3.len(), 2);
}
